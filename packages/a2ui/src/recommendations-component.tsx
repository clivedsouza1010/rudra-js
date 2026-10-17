import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { createComponentImplementation, type ReactComponentImplementation } from '@a2ui/react/v0_9';
import { RudraComponent, type RudraComponentProps } from '@rudra-js/react';
import { rudraRecommendationsApi } from './recommendations-api.js';
import {
  isAwaitingBoundHint,
  pickRecommendationRequest,
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
  /** Shown until the first recommendations arrive. Nothing is shown by default. */
  placeholder?: ReactNode;
  /**
   * Told about a load that failed, a result that isn't a recommendation result, or a block that
   * threw while rendering. Nothing is shown in any of those cases.
   */
  onError?: (error: unknown) => void;
}

type ErrorListener = ((error: unknown) => void) | undefined;

/**
 * How long a change of hints settles before the component asks again, so a search bound to a text
 * field asks once the shopper pauses rather than once per keystroke. The first load doesn't wait.
 */
export const RELOAD_DELAY_MS = 300;

type LoadState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; result: RecommendationResult; requestKey: string };

const LOADING: LoadState = { status: 'loading' };

async function loadResult(
  loadRecommendations: RecommendationLoader,
  request: RecommendationRequest,
  signal: AbortSignal,
): Promise<RecommendationResult> {
  return parseRecommendationResult(await loadRecommendations(request, signal));
}

/**
 * Loads a result for the request, and again whenever the request changes. The last result stays
 * on screen until the next one arrives, and a result for a request that has since changed is
 * dropped.
 */
function useRecommendationResult(
  request: RecommendationRequest,
  isAwaitingHints: boolean,
  loadRecommendations: RecommendationLoader,
  onError: ErrorListener,
): LoadState {
  const [state, setState] = useState<LoadState>(LOADING);
  const hasRequested = useRef(false);

  // The binder hands over new props on every render, so the request is compared by value.
  const requestKey = JSON.stringify(request);

  useEffect(() => {
    if (isAwaitingHints) return undefined;

    const controller = new AbortController();
    const asked: RecommendationRequest = JSON.parse(requestKey);

    const timer = setTimeout(
      () => {
        hasRequested.current = true;
        loadResult(loadRecommendations, asked, controller.signal).then(
          (result) => {
            if (!controller.signal.aborted) setState({ status: 'ready', result, requestKey });
          },
          (error: unknown) => {
            if (controller.signal.aborted) return;
            setState({ status: 'failed' });
            onError?.(error);
          },
        );
      },
      hasRequested.current ? RELOAD_DELAY_MS : 0,
    );

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [requestKey, isAwaitingHints, loadRecommendations, onError]);

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
  request: RecommendationRequest;
  isAwaitingHints: boolean;
  loadRecommendations: RecommendationLoader;
  onError: ErrorListener;
  placeholder: ReactNode;
  renderProps: Omit<RudraComponentProps, 'spec' | 'products' | 'bundles'>;
}

function RecommendationsView({
  request,
  isAwaitingHints,
  loadRecommendations,
  onError,
  placeholder,
  renderProps,
}: RecommendationsViewProps) {
  const state = useRecommendationResult(request, isAwaitingHints, loadRecommendations, onError);

  switch (state.status) {
    case 'loading':
      return placeholder;
    case 'failed':
      return null;
    case 'ready':
      return (
        // Keyed by request, so a new result gets a fresh boundary.
        <RenderFailureBoundary key={state.requestKey} onError={onError}>
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
      request={pickRecommendationRequest(props)}
      isAwaitingHints={isAwaitingBoundHint(context.componentModel.properties, props)}
      loadRecommendations={loadRecommendations}
      onError={onError}
      placeholder={placeholder}
      renderProps={renderProps}
    />
  ));
}
