import { buildRecommendationMessages, type RecommendationResult } from '@rudra-js/a2ui/server';

export function messagesFor(result: RecommendationResult, locale: string) {
  return buildRecommendationMessages(result, {
    surfaceId: 'rudra_recommendations',
    shopUrl: 'https://shop.example',
    locale,
  });
}
