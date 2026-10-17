import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createComponentImplementation, type ReactComponentImplementation } from '@a2ui/react/v0_9';
import type { ComponentModel } from '@a2ui/web_core/v0_9';
import { RudraComponent, type RudraComponentProps } from '@rudra-js/react';
import { rudraRecommendationsApi } from './recommendations-api.js';
import {
  pickRecommendationRequest,
  type RecommendationHint,
  type RecommendationRequest,
} from './recommendation-request.js';
import { parseRecommendationResult, type RecommendationResult } from './recommendation-result.js';

/**
 * Fetches recommendations from your server. Abort the request when `signal` aborts: the agent
 * changed what it asked for, or the component left the page.
 */
export type RecommendationLoader = (
  request: RecommendationRequest,
  signal: AbortSignal,
) => Promise<RecommendationResult>;

export interface RudraRecommendationsOptions extends Omit<
  RudraComponentProps,
  'spec' | 'products' | 'bundles'
> {
  loadRecommendations: RecommendationLoader;
  /** Shown until the first load finishes. Nothing is shown by default, or after a failure. */
  placeholder?: ReactNode;
  /**
   * Told about a load that failed, a result that isn't a recommendation result, or a block that
   * threw while rendering. Nothing is shown in any of those cases.
   */
  onError?: (error: unknown) => void;
}

type ErrorListener = ((error: unknown) => void) | undefined;

/**
 * How long the hints have to hold still before the component asks, the first time as well. A data
 * model that arrives within this time of the components is in the first request, and a search
 * bound to a text field asks once the shopper pauses rather than once per keystroke.
 */
export const HINT_SETTLE_MS = 300;

type LoadState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; result: RecommendationResult; loadNumber: number };

const LOADING: LoadState = { status: 'loading' };

async function loadResult(
  loadRecommendations: RecommendationLoader,
  request: RecommendationRequest,
  signal: AbortSignal,
): Promise<RecommendationResult> {
  return parseRecommendationResult(await loadRecommendations(request, signal));
}

/**
 * The properties the agent writes on the component, kept current as it rewrites them. A2UI only
 * re-renders a component when a resolved value changes, so this listens to the model itself.
 */
function useWrittenProperties(model: ComponentModel): Readonly<Record<string, unknown>> {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const subscription = model.onUpdated.subscribe(onChange);
      return () => subscription.unsubscribe();
    },
    [model],
  );
  return useSyncExternalStore(subscribe, () => model.properties);
}

/**
 * Loads a result for the request once it has held still, and again whenever it changes. The last
 * result stays on screen until the next one arrives, and a result for a request that has since
 * changed is dropped. A failed load shows nothing until the request changes.
 */
function useRecommendationResult(
  request: RecommendationRequest,
  loadRecommendations: RecommendationLoader,
  onError: ErrorListener,
): LoadState {
  const [state, setState] = useState<LoadState>(LOADING);
  const shownRequestKey = useRef<string | null>(null);
  const loadCount = useRef(0);

  // The binder hands over new props on every render, so the request is compared by value.
  const requestKey = JSON.stringify(request);

  useEffect(() => {
    // The hints changed and came back to the ones the block on screen was loaded for.
    if (requestKey === shownRequestKey.current) return undefined;

    const controller = new AbortController();
    const asked: RecommendationRequest = JSON.parse(requestKey);

    const timer = setTimeout(() => {
      loadResult(loadRecommendations, asked, controller.signal).then(
        (result) => {
          if (controller.signal.aborted) return;
          shownRequestKey.current = requestKey;
          loadCount.current += 1;
          setState({ status: 'ready', result, loadNumber: loadCount.current });
        },
        (error: unknown) => {
          if (controller.signal.aborted) return;
          shownRequestKey.current = null;
          setState({ status: 'failed' });
          onError?.(error);
        },
      );
    }, HINT_SETTLE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [requestKey, loadRecommendations, onError]);

  return state;
}

interface RenderFailureBoundaryProps {
  onError: ErrorListener;
  children: ReactNode;
}

/**
 * Shows nothing in place of a block that throws while rendering, from a custom `hrefForSku` or
 * `formatPrice` for instance. Without it, React would take down the whole surface, the agent's own
 * components included.
 */
class RenderFailureBoundary extends Component<RenderFailureBoundaryProps, { hasFailed: boolean }> {
  override state = { hasFailed: false };

  static getDerivedStateFromError() {
    return { hasFailed: true };
  }

  override componentDidCatch(error: unknown) {
    this.props.onError?.(error);
  }

  override render() {
    return this.state.hasFailed ? null : this.props.children;
  }
}

interface RecommendationsViewProps {
  model: ComponentModel;
  resolved: Partial<Record<RecommendationHint, unknown>>;
  loadRecommendations: RecommendationLoader;
  onError: ErrorListener;
  placeholder: ReactNode;
  renderProps: Omit<RudraComponentProps, 'spec' | 'products' | 'bundles'>;
}

function RecommendationsView({
  model,
  resolved,
  loadRecommendations,
  onError,
  placeholder,
  renderProps,
}: RecommendationsViewProps) {
  const written = useWrittenProperties(model);
  const request = pickRecommendationRequest(written, resolved);
  const state = useRecommendationResult(request, loadRecommendations, onError);

  switch (state.status) {
    case 'loading':
      return placeholder;
    case 'failed':
      return null;
    case 'ready':
      return (
        // Keyed by load, so each new result gets a boundary that hasn't failed.
        <RenderFailureBoundary key={state.loadNumber} onError={onError}>
          <RudraComponent
            {...renderProps}
            spec={state.result.spec}
            products={state.result.products}
            bundles={state.result.bundles ?? []}
          />
        </RenderFailureBoundary>
      );
    default:
      state satisfies never;
      return null;
  }
}

/**
 * Makes the A2UI implementation of the recommendation component, for the catalog your surfaces
 * use. The agent only says what the shopper is looking at; `loadRecommendations` asks your server,
 * and what it returns is checked and rendered by `RudraComponent`, the same as on a product page.
 *
 * It renders in the browser only. A2UI renders on the client, and this component loads its
 * recommendations after it mounts.
 */
export function createRudraRecommendationsComponent({
  loadRecommendations,
  placeholder = null,
  onError,
  ...renderProps
}: RudraRecommendationsOptions): ReactComponentImplementation {
  return createComponentImplementation(rudraRecommendationsApi, ({ props, context }) => (
    <RecommendationsView
      model={context.componentModel}
      resolved={props}
      loadRecommendations={loadRecommendations}
      onError={onError}
      placeholder={placeholder}
      renderProps={renderProps}
    />
  ));
}
