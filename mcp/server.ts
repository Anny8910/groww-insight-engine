import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { NotesEntry } from "../lib/types";
import {
  appendNotesEntry,
  createEmailDraft,
  readEmailDrafts,
  readNotesLog,
} from "../lib/store";
import { nowIso, verifyApprovalToken } from "../lib/env";

export const MCP_SERVER_NAME = "review-insights-notes";
export const MCP_SERVER_VERSION = "1.0.0";

interface ApprovalInput {
  decisionId?: string;
  approvedBy?: string;
  approvedAt?: string;
  approvalToken?: string;
  useElicitation?: boolean;
}

interface ResolvedApproval {
  approved: true;
  approvedBy: string;
  approvedAt: string;
}

const approvalZ = z
  .object({
    decisionId: z.string().optional(),
    approvedBy: z.string().optional(),
    approvedAt: z.string().optional(),
    approvalToken: z.string().optional(),
    useElicitation: z.boolean().optional(),
  })
  .optional();

export function createReviewInsightsServer(): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    {},
  );
  const inner = server.server;

  /**
   * Approval gate. Every mutating tool must pass through here.
   * Two supported mechanisms:
   *  - approvalToken verified against the shared secret (web app, after UI approval)
   *  - MCP elicitation: the server asks the connected user for explicit approval (CLI)
   * Anything else is refused with an "Approval required" error and no write happens.
   */
  async function resolveApproval(
    action: string,
    approval?: ApprovalInput,
  ): Promise<ResolvedApproval> {
    if (approval?.useElicitation) {
      const result = await inner.elicitInput({
        mode: "form",
        message: `MCP action requires approval\n\n${action}\n\nApprove and log this to the internal tool?`,
        requestedSchema: {
          type: "object",
          properties: {
            approved: { type: "boolean", description: "Approve the action?" },
            approvedBy: { type: "string", description: "Your name", minLength: 1 },
          },
          required: ["approved", "approvedBy"],
        },
      } as never);
      const content = result.content as { approved?: boolean; approvedBy?: string };
      if (content.approved !== true) {
        throw new McpError(ErrorCode.InvalidParams, `Action rejected by user (${action})`);
      }
      return {
        approved: true,
        approvedBy: content.approvedBy?.trim() || "cli-user",
        approvedAt: nowIso(),
      };
    }

    if (approval?.approvalToken && approval.decisionId && approval.approvedAt) {
      const ok = verifyApprovalToken({
        decisionId: approval.decisionId,
        approvedBy: approval.approvedBy || "",
        approvedAt: approval.approvedAt,
        token: approval.approvalToken,
      });
      if (!ok) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Approval signature invalid or tampered. Write action NOT performed.",
        );
      }
      return {
        approved: true,
        approvedBy: approval.approvedBy || "web-user",
        approvedAt: approval.approvedAt,
      };
    }

    throw new McpError(
      ErrorCode.InvalidParams,
      `Approval required before "${action}". Provide a signed approvalToken (web flow) or set approval.useElicitation=true (CLI flow).`,
    );
  }

  server.registerTool(
    "append_to_notes",
    {
      title: "Append review insights to Notes",
      description:
        "Appends the weekly review-insights entry (date, top themes, weekly pulse, identified fee issue, explanation bullets, source links) to the internal Notes document. Approval gated.",
      inputSchema: {
        date: z.string().describe("YYYY-MM-DD of the entry."),
        top_themes: z.array(z.string()),
        weekly_pulse: z.string(),
        identified_fee_issue: z.string(),
        explanation_bullets: z.array(z.string()),
        source_links: z.array(z.string()).optional(),
        approval: approvalZ,
      },
    },
    async (args: any) => {
      const inp = args as NotesEntry & { approval?: ApprovalInput };
      const approval = await resolveApproval(
        `Append review-insights entry for ${inp.date} to the internal Notes doc`,
        inp.approval,
      );
      const { entry, count } = appendNotesEntry({
        date: inp.date,
        top_themes: inp.top_themes,
        weekly_pulse: inp.weekly_pulse,
        identified_fee_issue: inp.identified_fee_issue,
        explanation_bullets: inp.explanation_bullets,
        source_links: inp.source_links,
        decisionId: inp.approval?.decisionId,
        approvedBy: approval.approvedBy,
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, count, appendedAt: entry.appendedAt }) }],
      };
    },
  );

  server.registerTool(
    "create_email_draft",
    {
      title: "Create support/release email draft",
      description:
        "Creates a draft email (Subject: Weekly Product Pulse + Customer Clarification) combining the weekly pulse and the fee explanation as a reusable support snippet. Does NOT send. Approval gated.",
      inputSchema: {
        subject: z.string(),
        to: z.string().optional(),
        pulse_text: z.string(),
        fee_explainer_bullets: z.array(z.string()),
        source_links: z.array(z.string()).optional(),
        approval: approvalZ,
      },
    },
    async (args: any) => {
      const inp = args as {
        subject?: string;
        to?: string;
        pulse_text: string;
        fee_explainer_bullets: string[];
        source_links?: string[];
        approval?: ApprovalInput;
      };
      const approval = await resolveApproval(
        `Create email draft "${inp.subject}"`,
        inp.approval,
      );
      const bullets = (inp.fee_explainer_bullets || []).join("\n");
      const src = (inp.source_links || []).join("\n");
      const includeSrc = src.length > 0 && !/https?:\/\//.test(bullets);
      const draft = createEmailDraft({
        subject: inp.subject || "Weekly Product Pulse + Customer Clarification",
        to: inp.to || "support-leads@growwchat.dev",
        body: [
          "Hi team,",
          "",
          "Here is this week's product pulse and a ready-to-use customer clarification for the recurring fee question.",
          "",
          "--- WEEKLY PRODUCT PULSE ---",
          inp.pulse_text,
          "",
          "--- FEE EXPLAINER (reusable support snippet) ---",
          bullets,
          ...(includeSrc ? [src] : []),
          "",
          "Draft only — no auto-send. Review and send when ready.",
        ].join("\n"),
        decisionId: inp.approval?.decisionId,
        approvedBy: approval.approvedBy,
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, filename: draft.filename }) }],
      };
    },
  );

  server.registerTool(
    "read_notes",
    {
      title: "Read notes log",
      description: "Reads the internal Notes document entries (read-only, no approval needed).",
      inputSchema: { _meta: z.string().optional() },
    },
    async () => {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: true, entries: readNotesLog() }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "read_email_drafts",
    {
      title: "Read email drafts",
      description: "Reads the created email drafts (read-only, no approval needed).",
      inputSchema: { _meta: z.string().optional() },
    },
    async () => {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: true, drafts: readEmailDrafts() }),
          },
        ],
      };
    },
  );

  return server;
}