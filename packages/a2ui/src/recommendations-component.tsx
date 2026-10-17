import { useEffect, useState, type ReactNode } from 'react';
import { createComponentImplementation, type ReactComponentImplementation } from '@a2ui/react/v0_9';
import { RudraComponent, type RudraComponentProps } from '@rudra-js/react';
import { rudraRecommendationsApi } from './recommendations-api.js';
import { pickRecommendationRequest, type RecommendationRequest } from './recommendation-request.js';
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
  /** Shown while recommendations load. Nothing is shown by default. */
  placeholder?: ReactNode;
  /**
   * Told about a load that failed, or that returned something that isn't a recommendation result.
   * Nothing is shown in either case.
   */
  onError?: (error: unknown) => void;
}

type LoadState =
  { status: 'loading' } | { status: 'failed' } | { status: 'ready'; result: RecommendationResult };

const LOADING: LoadState = { status: 'loading' };

async function loadResult(
  loadRecommendations: RecommendationLoader,
  request: RecommendationRequest,
  signal: AbortSignal,
): Promise<RecommendationResult> {
  return parseRecommendationResult(await loadRecommendations(request, signal));
}

function useRecommendationResult(
  request: RecommendationRequest,
  loadRecommendations: RecommendationLoader,
  onError: ((error: unknown) => void) | undefined,
): LoadState {
  const [state, setState] = useState<LoadState>(LOADING);

  // The binder hands over new props on every render, so the request is compared by value.
  const requestKey = JSON.stringify(request);

  useEffect(() => {
    const controller = new AbortController();
    const asked: RecommendationRequest = JSON.parse(requestKey);
    setState(LOADING);

    loadResult(loadRecommendations, asked, controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) setState({ status: 'ready', result });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: 'failed' });
        onError?.(error);
      },
    );

    return () => controller.abort();
  }, [requestKey, loadRecommendations, onError]);

  return state;
}

interface RecommendationsViewProps {
  request: RecommendationRequest;
  loadRecommendations: RecommendationLoader;
  onError: ((error: unknown) => void) | undefined;
  placeholder: ReactNode;
  renderProps: Omit<RudraComponentProps, 'spec' | 'products' | 'bundles'>;
}

function RecommendationsView({
  request,
  loadRecommendations,
  onError,
  placeholder,
  renderProps,
}: RecommendationsViewProps) {
  const state = useRecommendationResult(request, loadRecommendations, onError);

  switch (state.status) {
    case 'loading':
      return placeholder;
    case 'failed':
      return null;
    case 'ready':
      return (
        <RudraComponent
          {...renderProps}
          spec={state.result.spec}
          products={state.result.products}
          bundles={state.result.bundles ?? []}
        />
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
  return createComponentImplementation(rudraRecommendationsApi, ({ props }) => (
    <RecommendationsView
      request={pickRecommendationRequest(props)}
      loadRecommendations={loadRecommendations}
      onError={onError}
      placeholder={placeholder}
      renderProps={renderProps}
    />
  ));
}
