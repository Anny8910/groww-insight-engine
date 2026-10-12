import type { Insights, Review, Theme } from "./types";
import { loadReviews, filterRecentWindow, windowBounds } from "./reviews";
import { detectFeeIssue, isFeeRelated } from "./feeDetection";
import { clusterThemes, pickQuotes } from "./cluster";


export async function buildInsights(
  csvPath?: string,
  fromDate = new Date(),
): Promise<Insights> {
  const all = loadReviews(csvPath);
  const recent = filterRecentWindow(all, 12, fromDate);
  const bounds = windowBounds(recent);

  const feeIssue = detectFeeIssue(recent);
  const { themes, method } = await clusterThemes(recent);

  const topThree = [...themes]
    .sort((a, b) => b.reviewIds.length - a.reviewIds.length)
    .slice(0, 3)
    .map(withQuoteCount(recent));

  const feeReviews = new Set(recent.filter(isFeeRelated).map((r) => r.reviewId));
  let feeThemeId: string | null = null;
  let bestOverlap = 0;
  for (const t of themes) {
    const overlap = t.reviewIds.filter((id) => feeReviews.has(id)).length;
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      feeThemeId = t.id;
    }
  }

  const quotes = pickQuotes(recent, themes, topThree, feeThemeId, 3);

  return {
    generatedAt: new Date().toISOString(),
    windowStart: bounds.start,
    windowEnd: bounds.end,
    reviewCount: recent.length,
    themes: themes.map(withQuoteCount(recent)),
    topThree,
    quotes,
    feeIssue,
    clusterMethod: method,
  };
}

function withQuoteCount(reviews: Review[]) {
  const byId = new Map(reviews.map((r) => [r.reviewId, r] as const));
  return (theme: Theme): Theme => ({
    ...theme,
    reviewIds: theme.reviewIds,
    quoteIds: theme.reviewIds
      .filter((id) => {
        const r = byId.get(id);
        return r && r.text.length >= 25;
      })
      .slice(0, 4),
  });
}
