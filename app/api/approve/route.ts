import { NextRequest } from "next/server";
import { validateDecisionInput, loadPending, updatePending, weekLabel, type PendingPayload } from "@/lib/workflow";
import { nowIso, signApprovalToken, today } from "@/lib/env";
import { logRejection, readEmailDrafts } from "@/lib/store";
import { withMcpClient } from "@/lib/mcpHost";
import type { NotesEntry } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Step 3 — Approval gate.
 * The user explicitly approves/rejects in the UI. On APPROVE, this handler mints a
 * signed approval token and only then invokes the MCP write tools. Rejecting never writes.
 *
 * On serverless hosts the analyzed payload is carried back from the client (`pending`)
 * because the ephemeral per-instance filesystem cannot be relied on across requests.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  let input;
  try {
    input = validateDecisionInput(body);
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }

  const pending = loadPending(input.decisionId) ?? coercePending(body.pending, input.decisionId);
  if (!pending) {
    return Response.json({ ok: false, error: "Decision not found." }, { status: 404 });
  }

  const approvedAt = nowIso();

  if (input.decision === "reject") {
    logRejection({ decisionId: input.decisionId, approvedBy: input.approvedBy, rejectedAt: approvedAt });
    updatePending(input.decisionId, "rejected");
    return Response.json({
      ok: true,
      status: "rejected",
      decisionId: input.decisionId,
      approvedBy: input.approvedBy,
      rejectedAt: approvedAt,
      message: "No tools were called. Nothing was written.",
    });
  }

  const approvalToken = signApprovalToken({
    decisionId: input.decisionId,
    approvedBy: input.approvedBy,
    approvedAt,
  });

  const notesEntry: NotesEntry = {
    date: today(),
    top_themes: pending.insights.topThree.map((t) => `${t.name} (${t.reviewIds.length})`),
    weekly_pulse: pending.pulse.summary,
    identified_fee_issue: `${pending.insights.feeIssue.label} — ${pending.insights.feeIssue.description}`,
    explanation_bullets: pending.feeExplanation.bullets,
    source_links: pending.feeExplanation.sourceLinks.map((s) => s.url),
  };

  const subject = `Weekly Product Pulse + Customer Clarification — ${weekLabel(pending.insights)}`;
  const pulseText = [
    `## Weekly Product Pulse — ${weekLabel(pending.insights)}`,
    "",
    pending.pulse.summary,
  ].join("\n");

  const result = await withMcpClient(async (host) => {
    const appendRes = await host.call("append_to_notes", {
      ...notesEntry,
      approval: {
        decisionId: input.decisionId,
        approvedBy: input.approvedBy,
        approvedAt,
        approvalToken,
      },
    } as never);
    const emailRes = await host.call("create_email_draft", {
      subject,
      to: "support-leads@growwchat.dev",
      pulse_text: pulseText,
      fee_explainer_bullets: pending.feeExplanation.bullets,
      source_links: pending.feeExplanation.sourceLinks.map((s) => `- ${s.title} (${s.url})`),
      approval: {
        decisionId: input.decisionId,
        approvedBy: input.approvedBy,
        approvedAt,
        approvalToken,
      },
    } as never);
    return { appendRes, emailRes };
  });

  updatePending(input.decisionId, "approved");

  const filename = (result.emailRes as { filename?: string } | undefined)?.filename;
  const emailDraft = readEmailDrafts().find((d) => d.filename === filename);

  return Response.json({
    ok: true,
    status: "approved",
    approvedBy: input.approvedBy,
    approvedAt,
    decisionId: input.decisionId,
    mcp: result,
    notesEntry,
    emailDraft,
  });
}

/** Validates a client-carried analyze payload and adapts it to a PendingPayload. */
function coercePending(raw: unknown, decisionId: string): PendingPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, any>;
  const ins = r.insights;
  const pulse = r.pulse;
  const fee = r.feeExplanation;
  if (
    !ins || !pulse || !fee ||
    !Array.isArray(ins.topThree) || !ins.feeIssue ||
    !Array.isArray(fee.bullets) || !Array.isArray(fee.sourceLinks) ||
    typeof pulse.summary !== "string"
  ) {
    return null;
  }
  return {
    decisionId,
    status: "open",
    createdAt: nowIso(),
    csvName: "client-payload",
    insights: ins,
    pulse,
    feeExplanation: fee,
  } as PendingPayload;
}
