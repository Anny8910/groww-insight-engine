import { createHash, createHmac, randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

export const ROOT_DIR = process.cwd();

const ON_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

export const DEFAULT_REVIEWS_CSV =
  process.env.REVIEWS_CSV || path.join(ROOT_DIR, "data", "reviews.csv");

export const SOURCES_PATH = path.join(ROOT_DIR, "data", "sources.json");

/**
 * Runtime writes (notes log, email drafts, pending decisions, rejections) must land in a
 * writable directory. On serverless hosts the project dir is read-only, so fall back to the
 * OS temp dir. Override with GROWW_DATA_DIR for a persistent volume.
 */
export const GENERATED_DIR =
  process.env.GROWW_DATA_DIR ||
  (ON_SERVERLESS
    ? path.join(os.tmpdir(), "groww-insight-engine")
    : path.join(ROOT_DIR, "data", "generated"));
export const PENDING_DIR = path.join(GENERATED_DIR, "pending");
export const NOTES_JSONL = path.join(GENERATED_DIR, "review-insights-notes.jsonl");
export const NOTES_MD = path.join(GENERATED_DIR, "product-notes.md");
export const EMAIL_DIR = path.join(GENERATED_DIR, "email-drafts");
export const REJECTIONS_JSONL = path.join(GENERATED_DIR, "approval-rejections.jsonl");

export function approvalSecret(): string {
  return process.env.APPROVAL_SECRET || "groww_insight_engine_approval_secret_change_me";
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix = "dec"): string {
  return `${prefix}_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

export function signApprovalToken(input: {
  decisionId: string;
  approvedBy: string;
  approvedAt: string;
}): string {
  return createHmac("sha256", approvalSecret())
    .update(`${input.decisionId}:${input.approvedBy}:${input.approvedAt}:approved`)
    .digest("hex");
}

export function verifyApprovalToken(input: {
  decisionId: string;
  approvedBy: string;
  approvedAt: string;
  token: string;
}): boolean {
  const expected = signApprovalToken(input);
  return expected.length === input.token.length && expected === input.token;
}

export function ensureDirs(): void {
  for (const dir of [GENERATED_DIR, PENDING_DIR, EMAIL_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function safeSlug(value: string, max = 40): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, max) || "draft"
  );
}

/** Deterministic short hash used to correlate a decision to stored content. */
export function shortHash(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 8);
}