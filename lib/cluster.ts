import type { Review, Theme } from "./types";
import { feeKeywords } from "./feeDetection";
import { chatJson, llmEnabled } from "./llm";

const MAX_THEMES = 5;

function reviewLines(reviews: Review[], limit = 55): string {
  return reviews
    .slice(0, limit)
    .map((r) => {
      const text = (r.text + " " + r.title).trim().slice(0, 130);
      return `${r.reviewId}|r${r.rating}|"${text}"`;
    })
    .join("\n");
}

interface LlmClusterResult {
  themes?: { theme_id?: string; name?: string; description?: string; review_ids?: string[] }[];
}

/** LLM-powered theme clustering (max 5 themes). Falls back to keyword buckets. */
export async function clusterThemes(
  reviews: Review[],
): Promise<{ themes: Theme[]; method: "llm" | "keyword" }> {
  if (llmEnabled()) {
    try {
      return {
        themes: sanitize(await llmCluster(reviews), reviews),
        method: "llm",
      };
    } catch (err) {
      console.warn("[cluster] LLM clustering failed, using keyword fallback:", err);
    }
  }
  return { themes: keywordCluster(reviews), method: "keyword" };
}

async function llmCluster(reviews: Review[]): Promise<Theme[]> {
  const prompt = `
You are a product-insights analyst for an Indian investing app (Groww-style). You are given raw customer reviews, one per line, in the format:

REVIEW_ID|DATE|rating N|"text"

Cluster the reviews into AT MOST 5 themes. Follow these rules strictly:
1. Every review must be assigned to exactly ONE theme.
2. Themes must be real, actionable product themes (e.g. "Fee & charge confusion", "App performance / order failures", "Mutual fund usability", "KYC & account setup"). Do not invent themes that do not fit the data.
3. A review about money being deducted from a mutual fund redemption belongs in the fee/charge theme, NOT in a mutual-fund-usability theme.
4. Pick theme names and descriptions that a product manager would write.
5. Return JSON only, with this exact shape:
{
  "themes": [
    {"theme_id": "T1", "name": "Fee & charge confusion", "description": "...", "review_ids": ["R001","R004"]}
  ]
}

Reviews:
${reviewLines(reviews)}`;

  const result = await chatJson<LlmClusterResult>(
    [
      {
        role: "system",
        content:
          "You are a structured JSON writer. Return ONLY a valid JSON object — no markdown fences, no commentary, no trailing text.",
      },
      { role: "user", content: prompt },
    ],
    { maxTokens: 1600, temperature: 0.2 },
  );

  const raw = Array.isArray(result.themes) ? result.themes : [];
  return raw.map((t, i) => ({
    id: t.theme_id || `T${i + 1}`,
    name: (t.name || `Theme ${i + 1}`).trim(),
    description: (t.description || "").trim(),
    reviewIds: Array.isArray(t.review_ids) ? t.review_ids : [],
    quoteIds: [],
  }));
}

function sanitize(themes: Theme[], reviews: Review[]): Theme[] {
  const validIds = new Set(reviews.map((r) => r.reviewId));
  const seen = new Set<string>();
  const themesOut: Theme[] = [];

  for (const raw of themes) {
    if (themesOut.length >= MAX_THEMES) break;
    if (!raw.name) continue;
    const ids: string[] = [];
    for (const id of raw.reviewIds) {
      if (!validIds.has(id) || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    if (ids.length === 0) continue;
    const out: Theme = { ...raw, reviewIds: ids, quoteIds: selectQuoteIds(ids, reviews) };
    themesOut.push(out);
  }

  const assigned = new Set(themesOut.flatMap((t) => t.reviewIds));
  const leftovers = reviews
    .map((r) => r.reviewId)
    .filter((id) => !assigned.has(id));
  if (leftovers.length > 0 && themesOut.length < MAX_THEMES) {
    themesOut.push({
      id: "T-other",
      name: "Other feedback",
      description: "Remaining mixed feedback that did not fit the top themes.",
      reviewIds: leftovers,
      quoteIds: selectQuoteIds(leftovers, reviews),
    });
  }
  return themesOut;
}

function selectQuoteIds(ids: string[], reviews: Review[]): string[] {
  return ids;
}

/** Deterministic keyword-bucket fallback clustering. */
export function keywordCluster(reviews: Review[]): Theme[] {
  const kyc = [
    "kyc",
    "aadhaar",
    "video call",
    "video kyc",
    "verification",
    "bank account",
    "micro deposit",
    "pan",
    "document",
  ];
  const perf = [
    "lag",
    "laggy",
    "slow",
    "freeze",
    "frozen",
    "crash",
    "hang",
    "timeout",
    "delay",
    "stuck",
    "white screen",
  ];
  const mfUx = [
    "sip",
    "redeem",
    "redemption",
    "switch",
    "fund",
    "folio",
    "calculator",
    "nav",
    "expense ratio",
    "comparison",
    "filter",
  ];

  const buckets = new Map<string, string[]>([
    ["fees", []],
    ["performance", []],
    ["mf_ux", []],
    ["kyc", []],
    ["other", []],
  ]);

  const feeKeywordsList = feeKeywords();

  for (const review of reviews) {
    const hay = `${review.text} ${review.title}`.toLowerCase();
    if (feeKeywordsList.some((k) => hay.includes(k))) {
      buckets.get("fees")!.push(review.reviewId);
    } else if (perf.some((k) => hay.includes(k))) {
      buckets.get("performance")!.push(review.reviewId);
    } else if (mfUx.some((k) => hay.includes(k))) {
      buckets.get("mf_ux")!.push(review.reviewId);
    } else if (kyc.some((k) => hay.includes(k))) {
      buckets.get("kyc")!.push(review.reviewId);
    } else {
      buckets.get("other")!.push(review.reviewId);
    }
  }

  const meta: Record<string, { name: string; desc: string }> = {
    fees: {
      name: "Fee & charge confusion",
      desc: "Reviews about deductions, exit loads, AMC, DP charges or other fees users did not understand.",
    },
    performance: {
      name: "App performance & order reliability",
      desc: "Orders lagging, charts freezing, and crashes during market hours.",
    },
    mf_ux: {
      name: "Mutual fund usability",
      desc: "Confusion with SIPs, redemption flow, fund switching and disclosure.",
    },
    kyc: {
      name: "KYC & account setup",
      desc: "Video KYC, bank verification and onboarding friction.",
    },
    other: {
      name: "Other feedback",
      desc: "Remaining mixed feedback including praise and feature requests.",
    },
  };

  const themes: Theme[] = [];
  for (const [key, ids] of buckets.entries()) {
    themes.push({
      id: key,
      name: meta[key].name,
      description: meta[key].desc,
      reviewIds: ids,
      quoteIds: selectQuoteIds(ids, reviews),
    });
  }
  return themes.filter((t) => t.reviewIds.length > 0);
}

/** Picks up to n distinct, informative real quotes from the corpus. */
export function pickQuotes(
  reviews: Review[],
  themes: Theme[],
  topThree: Theme[],
  feeId: string | null,
  n = 3,
): { reviewId: string; date: string; text: string; theme: string }[] {
  const byId = new Map(reviews.map((r) => [r.reviewId, r] as const));
  const themeName = new Map(themes.map((t) => [t.id, t.name]));

  const ordered = [...topThree].sort((a, b) => b.reviewIds.length - a.reviewIds.length);
  if (feeId && ordered[0]?.id !== feeId) {
    const feeTheme = topThree.find((t) => t.id === feeId);
    if (feeTheme) ordered.unshift(feeTheme);
  }

  const picked: { reviewId: string; date: string; text: string; theme: string }[] = [];
  const used = new Set<string>();
  for (const theme of ordered) {
    for (const id of theme.reviewIds) {
      if (used.has(id)) continue;
      const review = byId.get(id);
      if (!review || review.text.length < 25) continue;
      picked.push({
        reviewId: review.reviewId,
        date: review.date,
        text: review.text,
        theme: themeName.get(theme.id) ?? theme.name,
      });
      used.add(id);
      if (picked.length >= n) return picked;
    }
  }
  // Fallback: fill from whatever remains.
  for (const review of reviews) {
    if (picked.length >= n) break;
    if (used.has(review.reviewId) || review.text.length < 25) continue;
    picked.push({
      reviewId: review.reviewId,
      date: review.date,
      text: review.text,
      theme: "General",
    });
  }
  return picked;
}