import fs from "node:fs";
import type { FeeExplanation, Insights, WeeklyPulse } from "./types";
import { buildInsights } from "./analyze";
import { generatePulse } from "./pulse";
import { generateFeeExplanation } from "./feeExplainer";
import { ensureDirs, newId, PENDING_DIR, nowIso, DEFAULT_REVIEWS_CSV } from "./env";

export interface PendingPayload {
  decisionId: string;
  status: "open" | "approved" | "rejected";
  createdAt: string;
  csvName: string;
  insights: Insights;
  pulse: WeeklyPulse;
  feeExplanation: FeeExplanation;
}

export interface WorkflowOutput {
  decisionId: string;
  insights: Insights;
  pulse: WeeklyPulse;
  feeExplanation: FeeExplanation;
  weeklyPulseMarkdown: string;
}

export function weekLabel(insights: Insights): string {
  const end = new Date(insights.windowEnd);
  const start = new Date(insights.windowStart);
  const sameYear = start.getFullYear() === end.getFullYear();
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      ...(sameYear ? {} : { year: "numeric" }),
    });
  return `${fmt(start)} – ${fmt(end)}${sameYear ? `, ${end.getFullYear()}` : ""}`;
}

/** Runs the full analyze → pulse → explainer pipeline and stages a pending decision. */
export async function runWorkflow(csvPath?: string): Promise<WorkflowOutput> {
  ensureDirs();
  const insights = await buildInsights(csvPath);
  const pulse = await generatePulse(insights);
  const feeExplanation = await generateFeeExplanation(insights);

  const decisionId = newId("dec");
  const pending: PendingPayload = {
    decisionId,
    status: "open",
    createdAt: nowIso(),
    csvName: csvPath || DEFAULT_REVIEWS_CSV,
    insights,
    pulse,
    feeExplanation,
  };

  const file = pendingFile(decisionId);
  fs.writeFileSync(file, JSON.stringify(pending, null, 2), "utf8");

  return {
    decisionId,
    insights,
    pulse,
    feeExplanation,
    weeklyPulseMarkdown: [
      `## Weekly Product Pulse — ${weekLabel(insights)}`,
      "",
      pulse.summary,
      "",
      `_Generated ${insights.generatedAt.slice(0, 16).replace("T", " ")} UTC · ${insights.clusterMethod} clustering · ${insights.reviewCount} reviews in window_`,
    ].join("\n"),
  };
}

export function loadPending(decisionId: string): PendingPayload | null {
  const file = pendingFile(decisionId);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as PendingPayload;
}

export function updatePending(decisionId: string, status: "approved" | "rejected"): void {
  const file = pendingFile(decisionId);
  if (!fs.existsSync(file)) return;
  const pending = JSON.parse(fs.readFileSync(file, "utf8")) as PendingPayload;
  pending.status = status;
  fs.writeFileSync(file, JSON.stringify(pending, null, 2), "utf8");
}

function pendingFile(decisionId: string): string {
  return `${PENDING_DIR}/${decisionId}.json`;
}

export function validateDecisionInput(raw: Record<string, unknown>): {
  decisionId: string;
  decision: "approve" | "reject";
  approvedBy: string;
} {
  const decisionId = typeof raw.decisionId === "string" ? raw.decisionId.trim() : "";
  const approvedBy = typeof raw.approvedBy === "string" ? raw.approvedBy.trim() : "web-user";
  const decision = raw.decision === "reject" ? "reject" : "approve";
  if (!/^dec_\d+_[a-f0-9]+$/.test(decisionId)) {
    throw new Error("Invalid decisionId");
  }
  return { decisionId, decision, approvedBy };
}