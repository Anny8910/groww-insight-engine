export interface Review {
  reviewId: string;
  date: string; // YYYY-MM-DD
  rating: number;
  title: string;
  text: string;
  appVersion: string;
}

export interface Theme {
  id: string;
  name: string;
  description: string;
  reviewIds: string[];
  quoteIds: string[];
}

export interface FeeIssue {
  term: string;
  label: string;
  description: string;
  painCount: number;
  sampleQuotes: string[];
}

export interface Insights {
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  reviewCount: number;
  themes: Theme[]; // max 5
  topThree: Theme[];
  quotes: { reviewId: string; date: string; text: string; theme: string }[];
  feeIssue: FeeIssue;
  clusterMethod: "llm" | "keyword";
}

export interface WeeklyPulse {
  title: string;
  summary: string;
  quotes: string[];
  keyObservation: string;
  actionIdeas: string[]; // 3
  wordCount: number;
}

export interface FeeExplanation {
  feeName: string;
  bullets: string[]; // <=6, neutral, facts-only
  sourceLinks: { title: string; url: string }[]; // 2
  lastChecked: string;
}

export interface Source {
  id: string;
  title: string;
  url: string;
  domain: string;
  type: string;
  verified: string;
}

export interface NotesEntry {
  date: string;
  top_themes: string[];
  weekly_pulse: string;
  identified_fee_issue: string;
  explanation_bullets: string[];
  source_links: string[];
  decisionId?: string;
  approvedBy?: string;
  appendedAt?: string;
}

export interface EmailDraft {
  filename: string;
  subject: string;
  to: string;
  body: string;
  draft?: boolean;
  decisionId?: string;
  approvedBy?: string;
  createdAt?: string;
}