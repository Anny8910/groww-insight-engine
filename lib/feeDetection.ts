import type { FeeIssue, Review } from "./types";

export interface FeeTerm {
  term: string;
  label: string;
  keywords: string[];
}

export const FEE_TERMS: FeeTerm[] = [
  {
    term: "exit_load",
    label: "Exit load",
    keywords: ["exit load", "exit-load", "exitload", "load charged", "load was charged", "redemption fee", "redeem fee"],
  },
  {
    term: "amc",
    label: "Demat AMC / annual maintenance charge",
    keywords: ["amc", "annual maintenance", "dematerialisation charge", "demat charge", "75 rupee"],
  },
  {
    term: "dp_charges",
    label: "DP (depository participant) charges",
    keywords: ["dp charge", "dp charges", "dp fees", "depository"],
  },
  {
    term: "brokerage",
    label: "Brokerage / STT",
    keywords: ["brokerage", "stt", "security transaction tax", "commission"],
  },
  {
    term: "stamp_duty",
    label: "Stamp duty",
    keywords: ["stamp duty", "stamp fee"],
  },
  {
    term: "misc_fee",
    label: "Miscellaneous deductions on redemption",
    keywords: ["deducted", "deduction", "hidden charge", "hidden fee", "charged twice", "auto debit", "auto-debit", "fee without notice", "why was money"],
  },
];

const ALL_KEYWORDS = FEE_TERMS.flatMap((f) => f.keywords);

export function isFeeRelated(review: Review): boolean {
  const haystack = `${review.text} ${review.title}`.toLowerCase();
  return ALL_KEYWORDS.some((k) => haystack.includes(k));
}

export function detectFeeIssue(reviews: Review[]): FeeIssue {
  const scores = new Map<string, { term: FeeTerm; score: number; ids: string[] }>();
  for (const term of FEE_TERMS) {
    scores.set(term.term, { term, score: 0, ids: [] });
  }

  for (const review of reviews) {
    const haystack = `${review.text} ${review.title}`.toLowerCase();
    for (const term of FEE_TERMS) {
      let matched = 0;
      for (const k of term.keywords) {
        const occurrences = haystack.split(k).length - 1;
        if (occurrences > 0) matched += Math.min(3, occurrences);
      }
      if (matched > 0) {
        const slot = scores.get(term.term)!;
        slot.score += matched;
        slot.ids.push(review.reviewId);
      }
    }
  }

  let best: { term: FeeTerm; score: number; ids: string[] } | null = null;
  for (const slot of scores.values()) {
    if (slot.score > 0 && (!best || slot.score > best.score)) best = slot;
  }

  const term = best?.term ?? FEE_TERMS[0];
  const painIds = best?.ids ?? [];
  const sampleQuotes = reviews
    .filter((r) => painIds.includes(r.reviewId))
    .slice(0, 4)
    .map((r) => r.text);

  return {
    term: term.term,
    label: term.label,
    description: descriptionFor(term.label, painIds.length),
    painCount: painIds.length,
    sampleQuotes,
  };
}

export function feeKeywords(): string[] {
  return ALL_KEYWORDS;
}

function descriptionFor(label: string, count: number): string {
  return `Users are being charged "${label}" without a clear prior explanation. Found ${count} reviews in the window that reference this charge while redeeming, selling or checking statements.`;
}