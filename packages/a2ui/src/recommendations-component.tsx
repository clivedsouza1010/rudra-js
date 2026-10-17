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
import { pickRecommendationRequest, type RecommendationRequest } from './recommendation-request.js';
import { parseRecommendationResult, type RecommendationResult } from './recommendation-result.js';

export type RecommendationLoader = (
  request: RecommendationRequest,
  signal: AbortSignal,
) => Promise<RecommendationResult>;

export interface RudraRecommendationsOptions extends Omit<
  RudraComponentProps,
  'spec' | 'products' | 'bundles'
> {
  loadRecommendations: RecommendationLoader;
  placeholder?: ReactNode;
  onError?: (error: unknown) => void;
}

const HINT_SETTLE_MS = 300;

type LoadState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; result: RecommendationResult; requestKey: string };

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

function useRecommendationResult(
  request: RecommendationRequest,
  loadRecommendations: RecommendationLoader,
  onError: RudraRecommendationsOptions['onError'],
): LoadState {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const shownRequestKey = useRef<string | null>(null);
  const requestKey = JSON.stringify(request);

  useEffect(() => {
    if (requestKey === shownRequestKey.current) return undefined;
    const controller = new AbortController();
    const asked: RecommendationRequest = JSON.parse(requestKey);

    async function load() {
      try {
        const result = parseRecommendationResult(
          await loadRecommendations(asked, controller.signal),
        );
        if (controller.signal.aborted) return;
        shownRequestKey.current = requestKey;
        setState({ status: 'ready', result, requestKey });
      } catch (error) {
        if (controller.signal.aborted) return;
        shownRequestKey.current = null;
        setState({ status: 'failed' });
        onError?.(error);
      }
    }

    const timer = setTimeout(load, HINT_SETTLE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [requestKey, loadRecommendations, onError]);

  return state;
}

interface RenderFailureBoundaryProps {
  onError: RudraRecommendationsOptions['onError'];
  children: ReactNode;
}

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

export function createRudraRecommendationsComponent({
  loadRecommendations,
  placeholder = null,
  onError,
  ...blockProps
}: RudraRecommendationsOptions): ReactComponentImplementation {
  return createComponentImplementation(
    rudraRecommendationsApi,
    function RudraRecommendations({ props, context }) {
      const written = useWrittenProperties(context.componentModel);
      const request = pickRecommendationRequest(written, props);
      const state = useRecommendationResult(request, loadRecommendations, onError);

      if (state.status === 'loading') return placeholder;
      if (state.status === 'failed') return null;
      return (
        <RenderFailureBoundary key={state.requestKey} onError={onError}>
          <RudraComponent {...blockProps} {...state.result} />
        </RenderFailureBoundary>
      );
    },
  );
}
