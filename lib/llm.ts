import { z } from "zod";

const ChatResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string().nullable(),
      }),
    }),
  ),
});

export function llmEnabled(): boolean {
  const key = process.env.GROQ_API_KEY || "";
  return key.length > 20;
}

const MODEL_CHAIN = () => {
  const preferred = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
  return [
    preferred,
    ...["openai/gpt-oss-20b", "qwen/qwen3.8-27b"].filter((m) => m !== preferred),
  ];
};

function cfg() {
  return {
    baseUrl: process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
    apiKey: process.env.GROQ_API_KEY || "",
  };
}

let lastRequestAt = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Serializes outbound LLM calls with a minimum gap to respect free-tier TPM limits. */
async function gate(): Promise<void> {
  const gap = 1800 - (Date.now() - lastRequestAt);
  if (gap > 0) await sleep(gap);
  lastRequestAt = Date.now();
}

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmOptions {
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
}

export async function chat(
  messages: LlmMessage[],
  opts: LlmOptions = {},
): Promise<string> {
  if (!llmEnabled()) {
    throw new Error("GROQ_API_KEY is not set. LLM calls are disabled.");
  }
  const { baseUrl, apiKey } = cfg();
  const models = MODEL_CHAIN();
  let lastErr: Error | null = null;
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    try {
      await gate();
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: opts.temperature ?? 0.3,
          max_tokens: opts.maxTokens ?? 3000,
        }),
      });
      if (res.status === 429) {
        lastErr = new Error(`HTTP 429 rate limit on ${model}`);
        await sleep(6000 * (i + 1));
        continue;
      }
      if (res.status === 413 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status} on ${model}`);
        await sleep(1200 * (i + 1));
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`LLM request failed (${res.status}): ${body.slice(0, 500)}`);
      }
      const data = ChatResponseSchema.parse(await res.json());
      const content = data.choices?.[0]?.message?.content ?? "";
      if (!content) throw new Error("LLM returned empty content");
      return content.trim();
    } catch (err) {
      lastErr = err as Error;
      if (models.length > 1) {
        console.warn(`[llm] model ${model} failed, next fallback: ${(err as Error).message?.slice(0, 140)}`);
      }
    }
  }
  throw lastErr ?? new Error("All LLM models failed");
}

/**
 * Chat that must return a JSON object. No provider json-mode (avoids Groq validation
 * quirks); prompts the model for strict JSON and extracts tolerantly.
 */
export async function chatJson<T>(
  messages: LlmMessage[],
  opts: LlmOptions = {},
): Promise<T> {
  const raw = await chat(messages, opts);
  return extractJson<T>(raw);
}

export function extractJson<T>(raw: string): T {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const candidate = cleaned.slice(start, end + 1);
    try {
      return JSON.parse(candidate) as T;
    } catch {
      /* fall through to full parse */
    }
  }
  return JSON.parse(cleaned) as T;
}