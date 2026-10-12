import { NextRequest } from "next/server";
import { validateDecisionInput, loadPending, updatePending, weekLabel } from "@/lib/workflow";
import { nowIso, signApprovalToken, today } from "@/lib/env";
import { logRejection } from "@/lib/store";
import { withMcpClient } from "@/lib/mcpHost";
import type { NotesEntry } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Step 3 — Approval gate.
 * The user explicitly approves/rejects in the UI. On APPROVE, this handler mints a
 * signed approval token and only then invokes the MCP write tools. Rejecting never writes.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  let input;
  try {
    input = validateDecisionInput(body);
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }

  const pending = loadPending(input.decisionId);
  if (!pending) {
    return Response.json({ ok: false, error: "Decision not found." }, { status: 404 });
  }
  if (pending.status !== "open") {
    return Response.json({ ok: true, status: pending.status, alreadyProcessed: true });
  }

  const approvedAt = nowIso();

  if (input.decision === "reject") {
    logRejection({ decisionId: input.decisionId, approvedBy: input.approvedBy });
    updatePending(input.decisionId, "rejected");
    return Response.json({
      ok: true,
      status: "rejected",
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
    });
    const emailRes = await host.call("create_email_draft", {
      subject,
      to: "support-leads@growwchat.dev",
      pulse_text: pulseText,
      fee_explainer_bullets: pending.feeExplanation.bullets,
      source_links: pending.feeExplanation.sourceLinks.map(
        (s) => `- ${s.title} (${s.url})`,
      ),
      approval: {
        decisionId: input.decisionId,
        approvedBy: input.approvedBy,
        approvedAt,
        approvalToken,
      },
    });
    return { appendRes, emailRes };
  });

  updatePending(input.decisionId, "approved");

  return Response.json({
    ok: true,
    status: "approved",
    approvedBy: input.approvedBy,
    approvedAt,
    decisionId: input.decisionId,
    mcp: result,
    notesEntry,
  });
}