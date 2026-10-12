import fs from "node:fs";
import path from "node:path";
import type { EmailDraft, NotesEntry } from "./types";
import {
  ensureDirs,
  EMAIL_DIR,
  NOTES_JSONL,
  NOTES_MD,
  REJECTIONS_JSONL,
  safeSlug,
  today,
  nowIso,
} from "./env";

export interface AppendResult {
  entry: NotesEntry;
  count: number;
}

export function appendNotesEntry(entry: Omit<NotesEntry, "appendedAt">): AppendResult {
  ensureDirs();
  const full: NotesEntry = { ...entry, appendedAt: nowIso() };
  fs.appendFileSync(NOTES_JSONL, JSON.stringify(full) + "\n", "utf8");

  const mdBlock = [
    "------------------------------",
    `### Entry · ${full.appendedAt}  · decisionId=${full.decisionId ?? "n/a"}`,
    `**Date:** ${full.date}`,
    `**Top themes:** ${full.top_themes.join(" | ")}`,
    "",
    "**Weekly pulse**",
    "",
    full.weekly_pulse,
    "",
    `**Identified fee issue:** ${full.identified_fee_issue}`,
    "**Explanation bullets:**",
    ...full.explanation_bullets.map((b) => `- ${b}`),
    `**Source links:** ${full.source_links.join(" · ")}`,
  ].join("\n");
  fs.appendFileSync(NOTES_MD, mdBlock + "\n\n", "utf8");

  return { entry: full, count: countNotes() };
}

export function countNotes(): number {
  if (!fs.existsSync(NOTES_JSONL)) return 0;
  return fs
    .readFileSync(NOTES_JSONL, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0).length;
}

export function readNotesLog(): NotesEntry[] {
  if (!fs.existsSync(NOTES_JSONL)) return [];
  return fs
    .readFileSync(NOTES_JSONL, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      try {
        return JSON.parse(l) as NotesEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is NotesEntry => e !== null);
}

export interface CreateEmailDraftInput {
  subject: string;
  body: string;
  to?: string;
  decisionId?: string;
  approvedBy?: string;
}

export function createEmailDraft(input: CreateEmailDraftInput): EmailDraft {
  ensureDirs();
  const filename = `${today()}_${safeSlug(input.subject, 30)}.txt`;
  const fullPath = path.join(EMAIL_DIR, filename);
  const draft: EmailDraft = {
    filename,
    subject: input.subject,
    to: input.to || "support-leads@growwchat.dev",
    body: input.body,
    draft: true,
    decisionId: input.decisionId,
    approvedBy: input.approvedBy,
    createdAt: nowIso(),
  };
  const content = [
    `To: ${draft.to}`,
    `Subject: ${draft.subject}`,
    `Draft: true (no auto-send)`,
    "",
    draft.body,
  ].join("\n");
  fs.writeFileSync(fullPath, content + "\n", "utf8");
  return draft;
}

export function readEmailDrafts(): EmailDraft[] {
  ensureDirs();
  return fs
    .readdirSync(EMAIL_DIR)
    .filter((f) => f.endsWith(".txt"))
    .map((f) => {
      const raw = fs.readFileSync(path.join(EMAIL_DIR, f), "utf8");
      return {
        filename: f,
        subject: raw.split("\n").find((l) => l.startsWith("Subject: "))?.slice(9) ?? f,
        to: raw.split("\n").find((l) => l.startsWith("To: "))?.slice(4) ?? "",
        body: raw,
        draft: true,
      } satisfies EmailDraft;
    })
    .sort((a, b) => (b.filename < a.filename ? -1 : 1));
}

export function logRejection(reason: {
  decisionId: string;
  approvedBy: string;
  rejectedAt?: string;
}): void {
  ensureDirs();
  fs.appendFileSync(
    REJECTIONS_JSONL,
    JSON.stringify({ ...reason, rejectedAt: reason.rejectedAt || nowIso() }) + "\n",
    "utf8",
  );
}

export function readRejections(): Array<{ decisionId: string; approvedBy: string; rejectedAt: string }> {
  if (!fs.existsSync(REJECTIONS_JSONL)) return [];
  return fs
    .readFileSync(REJECTIONS_JSONL, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((e): e is { decisionId: string; approvedBy: string; rejectedAt: string } => e !== null);
}