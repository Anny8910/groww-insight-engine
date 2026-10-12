import type { Insights, WeeklyPulse } from "./types";
import { chatJson, llmEnabled } from "./llm";

const MAX_WORDS = 250;

interface PulseField {
  title: string;
  body: string;
  keyObservation: string;
  actionIdeas: string[];
  quotes_used: string[];
}

/** Generates the ≤250-word Weekly Product Pulse, falling back to a template. */
export async function generatePulse(insights: Insights): Promise<WeeklyPulse> {
  if (llmEnabled()) {
    try {
      const pulse = await llmPulse(insights);
      if (pulse.summary.split(/\s+/).length <= MAX_WORDS) return pulse;
      console.warn("[pulse] LLM exceeded 250 words, using template fallback.");
    } catch (err) {
      console.warn("[pulse] LLM generation failed, using template:", err);
    }
  }
  return templatePulse(insights);
}

async function llmPulse(insights: Insights): Promise<WeeklyPulse> {
  const themeBlock = insights.topThree
    .map((t) => `- ${t.name} (${t.reviewIds.length} reviews): ${t.description}`)
    .join("\n");
  const quoteBlock = insights.quotes
    .map((q) => `- ${q.theme}: "${q.text}"`)
    .join("\n");

  const prompt = `
Write a "Weekly Product Pulse" for an internal product+support team. Use ONLY the insights below.
Required structure (plain markdown, in this order):
1. A short (1 line) "Key observation" section — what is trending or going wrong.
2. "Top themes" — 3 short bullets (theme name + plane one-liner).
3. "What users are saying" — include 2 of the provided quotes verbatim.
4. "Action ideas for the product team" — exactly 3 numbered, specific ideas.

Rules: Neutral, concise, no fluff. TOTAL OUTPUT MUST BE AT MOST 250 WORDS.

Insights:
Themes:
${themeBlock}

Verified user quotes:
${quoteBlock}

Recurring fee confusion: ${insights.feeIssue.label} — ${insights.feeIssue.description}`;

  const result = await chatJson<PulseField>(
    [
      {
        role: "system",
        content:
          "You are a structured JSON writer. Write tight internal product memos (under 250 words, no emojis). " +
          "Return ONLY a valid JSON object — no markdown fences, no commentary, no trailing text — using EXACTLY this shape: " +
          '{"title": string, "body": string (the full memo as markdown), "keyObservation": string, "actionIdeas": string[] (exactly 3), "quotes_used": string[] (up to 3 verbatim quotes)}',
      },
      { role: "user", content: prompt },
    ],
    { maxTokens: 1500, temperature: 0.4 },
  );

  const body = enforceWordLimit(result.body || "", MAX_WORDS);
  if (body.trim().length < 30) {
    throw new Error("LLM pulse body was empty or too short");
  }
  return {
    title: result.title || "Weekly Product Pulse",
    summary: body,
    quotes: Array.isArray(result.quotes_used) ? result.quotes_used.slice(0, 3) : [],
    keyObservation: result.keyObservation || "",
    actionIdeas: Array.isArray(result.actionIdeas)
      ? result.actionIdeas.slice(0, 3)
      : [],
    wordCount: body.split(/\s+/).length,
  };
}

function templatePulse(insights: Insights): WeeklyPulse {
  const t = insights.topThree;
  const obs = insights.feeIssue.sampleQuotes[0]
    ? `Fee confusion is the loudest signal: "${insights.feeIssue.sampleQuotes[0].slice(0, 140)}".`
    : "Sentiment is mixed; performance and onboarding friction continue to appear in reviews.";

  const md = [
    `Key observation: ${obs}`,
    "",
    "Top themes:",
    ...t.map((th) => `- ${th.name} (${th.reviewIds.length} reviews): ${th.description}`),
    "",
    "What users are saying:",
    ...insights.quotes.map((q) => `- "${q.text}"`),
    "",
    "Action ideas for the product team:",
    "1. Show the exit-load / applicable fee estimate at the point of placing a redeem order.",
    "2. Add a one-time in-app explainer for the most-confused fee before the user is charged.",
    "3. Publish a transparent fee FAQ surfaced by the support chat assistant.",
  ].join("\n");

  return {
    title: "Weekly Product Pulse",
    summary: enforceWordLimit(md, MAX_WORDS),
    quotes: insights.quotes.map((q) => q.text),
    keyObservation: obs,
    actionIdeas: [
      "Show the fee estimate at the point of placing a redeem order.",
      "Add a one-time in-app explainer for the most-confused fee before it is charged.",
      "Publish a transparent fee FAQ surfaced by the support chat assistant.",
    ],
    wordCount: enforceWordLimit(md, MAX_WORDS).split(/\s+/).length,
  };
}

function enforceWordLimit(md: string, max: number): string {
  const words = md.split(/\s+/);
  if (words.length <= max) return md;
  let out = "";
  let count = 0;
  for (const sentence of md.split(/(?<=[.\n])\s+/)) {
    const n = sentence.split(/\s+/).length;
    if (count + n > max) break;
    out += (out ? " " : "") + sentence;
    count += n;
  }
  return out.trim() || words.slice(0, max).join(" ");
}

/** HTML preview helper used by the UI. */
export function pulseToMarkdown(pulse: WeeklyPulse, weekLabel: string): string {
  return [
    `## ${pulse.title} — ${weekLabel}`,
    "",
    pulse.summary,
  ].join("\n");
}