import fs from "node:fs";
import type { FeeExplanation, Insights, Source } from "./types";
import { SOURCES_PATH, today } from "./env";
import { chatJson, llmEnabled } from "./llm";

const MAX_BULLETS = 6;

const TERM_SOURCE_MAP: Record<string, string[]> = {
  exit_load: ["groww-redeem-charges", "sebi-exit-load"],
  amc: ["groww-help"],
  dp_charges: ["groww-help"],
  brokerage: ["groww-help"],
  stamp_duty: ["groww-help"],
  misc_fee: ["groww-redeem-charges", "groww-help"],
};

function loadSources(): Source[] {
  if (fs.existsSync(SOURCES_PATH)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(SOURCES_PATH, "utf8")) as { sources: Source[] };
      if (Array.isArray(parsed.sources)) return parsed.sources;
    } catch {
      /* fall through */
    }
  }
  return [];
}

/** Picks exactly 2 official sources relevant to the identified fee. */
export function pickSources(feeTerm: string): Source[] {
  const all = loadSources();
  const desiredIds = TERM_SOURCE_MAP[feeTerm] ?? ["groww-redeem-charges", "groww-help"];
  const chosen = desiredIds
    .map((id) => all.find((s) => s.id === id))
    .filter((s): s is Source => Boolean(s));
  return chosen.slice(0, 2);
}

/** Builds the ≤6-bullet, neutral, fact-only explanation. */
export async function generateFeeExplanation(
  insights: Insights,
): Promise<FeeExplanation> {
  const sources = pickSources(insights.feeIssue.term);
  const lastChecked = today();

  if (llmEnabled()) {
    try {
      const out = await llmExplain(insights, sources, lastChecked);
      if (out.bullets.length <= MAX_BULLETS) return out;
      console.warn("[fee] LLM exceeded bullet limit, using template.");
    } catch (err) {
      console.warn("[fee] LLM generation failed, using template:", err);
    }
  }
  return templateExplanation(insights, sources, lastChecked);
}

interface LlmExplainResult {
  fee_name?: string;
  bullets?: string[];
}

async function llmExplain(
  insights: Insights,
  sources: Source[],
  lastChecked: string,
): Promise<FeeExplanation> {
  const prompt = `
Users of a Groww-style investing app are confused about this charge:
"${insights.feeIssue.label}"

Examples of recent user confusion:
${insights.feeIssue.sampleQuotes.map((q) => `- "${q}"`).join("\n")}

Write a customer-facing fee explainer. Rules:
- EXACTLY 3 to 6 bullet points.
- Neutral, facts-only tone. No marketing, no promises, no advice.
- Directly address the misunderstanding visible in the quotes.
- Each bullet must be a single sentence or a compact clause pair.
- Do not add a headline or intro sentence.
- Reference the two official sources in the last bullet as: "Sources: <Title1> (<URL1>) | <Title2> (<URL2>)".
- End the response JSON with a "last_checked" equal to "${lastChecked}".

Return JSON only:
{"fee_name":"...", "bullets":["...", "...", "..."], "last_checked":"${lastChecked}"}`;

  const result = await chatJson<LlmExplainResult & { last_checked?: string }>(
    [
      {
        role: "system",
        content:
          "You are a structured JSON writer. Write neutral, factual finance explainers in simple English. Never exceed the requested bullet count. Return ONLY a valid JSON object — no markdown fences, no commentary, no trailing text.",
      },
      { role: "user", content: prompt },
    ],
    { maxTokens: 1000, temperature: 0.2 },
  );

  const rawBullets = (result.bullets ?? []).slice(0, MAX_BULLETS);
  const bullets = enforceSources(rawBullets, sources);
  return {
    feeName: result.fee_name || insights.feeIssue.label,
    bullets,
    sourceLinks: sources.map((s) => ({ title: s.title, url: s.url })),
    lastChecked: result.last_checked || lastChecked,
  };
}

/**
 * Removes any hallucinated source bullet and guarantees exactly the real official
 * source links appear in the final bullet.
 */
function enforceSources(bullets: string[], sources: Source[]): string[] {
  const urlAllowed = (url: string) =>
    sources.some((s) => url.includes(s.url) || s.url.includes(url));
  const cleaned = bullets.filter((b) => {
    const urls = b.match(/https?:\/\/[^\s)"]+/g) ?? [];
    const isSourceLine = /source/i.test(b) || urls.length > 0;
    if (!isSourceLine) return true;
    return urls.every((u) => urlAllowed(u));
  });
  const sourceLine = `Sources: ${sources.map((s) => `${s.title} (${s.url})`).join(" | ")}`;
  const hasSourceLine = cleaned.some((b) => sources.every((s) => b.includes(s.url)));
  if (!hasSourceLine) {
    if (cleaned.length >= MAX_BULLETS) cleaned[MAX_BULLETS - 1] = sourceLine;
    else cleaned.push(sourceLine);
  }
  return cleaned.slice(0, MAX_BULLETS);
}

function templateExplanation(
  insights: Insights,
  sources: Source[],
  lastChecked: string,
): FeeExplanation {
  const isExitLoad = insights.feeIssue.term === "exit_load";
  const bullets = isExitLoad
    ? [
        "Exit load is a fee charged by the mutual fund (AMC), not by the app, when units are redeemed before the fund's stated holding period.",
        "In most equity funds it applies to redemptions made within 1 year of the purchase date of each SIP/lump-sum instalment.",
        "It is calculated as a percentage of the redemption value and is deducted from the amount credited to you.",
        "Funds must disclose the exit load in the scheme's Key Information Memorandum (KIM) and Scheme Information Document (SID), and most funds show it on their fact sheet.",
        "If you redeem after the load period, the exit load is typically nil.",
        `Sources: ${sources.map((s) => `${s.title} (${s.url})`).join(" | ")}`,
      ]
    : [
        `This charge is disclosed in the app's fee schedule and in the scheme documents before you complete the transaction.`,
        `It is applied by the relevant exchange, depository or fund house as applicable, not as an arbitrary app fee.`,
        "The exact amount depends on the transaction type and holding period.",
        `Sources: ${sources.map((s) => `${s.title} (${s.url})`).join(" | ")}`,
      ];

  return {
    feeName: insights.feeIssue.label,
    bullets: bullets.slice(0, MAX_BULLETS),
    sourceLinks: sources.map((s) => ({ title: s.title, url: s.url })),
    lastChecked,
  };
}