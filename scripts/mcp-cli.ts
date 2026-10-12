/**
 * CLI demo of the approval-gated MCP tools.
 *
 * Runs the MCP server over stdio as a child process, connects a real MCP client,
 * then:
 *   1. reads the notes log (read-only, no approval)
 *   2. tries a write WITHOUT approval -> must be refused (no write happens)
 *   3. runs the same write with MCP elicitation -> the server ASKS the connected
 *      client for explicit approval before the write is allowed to proceed
 *
 * When run in an interactive terminal you are prompted for the approval; when run
 * non-interactively (CI / piped stdin) the client auto-answers to demonstrate the
 * handshake without hanging.
 *
 * Run: npm run mcp:cli
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const INTERACTIVE = Boolean(process.stdin.isTTY);
const rl = INTERACTIVE ? createInterface({ input: process.stdin, output: process.stdout }) : null;

const TSX_BIN = path.resolve("node_modules/tsx/dist/cli.mjs");
const SERVER_TS = path.resolve("mcp/stdio.ts");

function textOf(result: unknown): string {
  const res = result as { content?: Array<{ type?: string; text?: string }> };
  return (res?.content ?? [])
    .filter((c) => c?.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("\n");
}

async function ask(prompt: string, fallback: string): Promise<string> {
  if (!rl) return fallback;
  return (await rl.question(prompt)).trim();
}

async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [TSX_BIN, SERVER_TS],
  });

  const client = new Client(
    { name: "groww-insight-cli", version: "1.0.0" },
    { capabilities: { elicitation: { form: {} } } } as never,
  );

  // The MCP client represents the user. When the server elicits approval we show
  // the request and (in a terminal) ask the human; otherwise we auto-approve.
  client.setRequestHandler(ElicitRequestSchema, async (request) => {
    const message = request.params?.message ?? "MCP server requests input";
    console.log(`\n[MCP elicitation] Server asks:\n  ${message.replace(/\n/g, "\n  ")}`);
    const answer = await ask("Approve? (y/n) [default y]: ", "y");
    const approved = ["", "y", "yes", "1"].includes(answer.toLowerCase());
    const name = (await ask("Your name (for the log): ", "cli-reviewer")) || "cli-reviewer";
    console.log(`[MCP elicitation] Response: approved=${approved}, by=${name}`);
    return { action: "accept", content: { approved, approvedBy: name } as never };
  });

  await client.connect(transport);
  console.log(`Connected to MCP server over stdio. (interactive=${INTERACTIVE})\n`);

  // 1) Read-only, no approval needed.
  const notesBefore = await client.callTool({ name: "read_notes", arguments: {} as never });
  const countBefore = ((JSON.parse(textOf(notesBefore)).entries) ?? []).length;
  console.log(`1) read_notes (read-only) -> entries: ${countBefore}\n`);

  // 2) Write without approval -> must be refused. MCP surfaces tool failures as
  //    results with isError=true (not thrown), so check that explicitly.
  const refused = await client.callTool({
    name: "append_to_notes",
    arguments: {
      date: "2026-10-12",
      top_themes: ["Fee confusion"],
      weekly_pulse: "Test without approval.",
      identified_fee_issue: "test",
      explanation_bullets: ["test"],
    } as never,
  });
  const notesAfterRefused = JSON.parse(textOf(await client.callTool({ name: "read_notes", arguments: {} as never }))).entries ?? [];
  if (refused.isError) {
    console.log(`2) append_to_notes without approval -> REFUSED: ${textOf(refused)}`);
  } else {
    console.log("2) ERROR: write succeeded WITHOUT approval (unexpected)");
  }
  console.log(`   note count unchanged: ${notesAfterRefused.length === countBefore}\n`);

  // 3) Write with elicitation -> the server asks the connected client for approval.
  console.log("3) Calling append_to_notes with approval.useElicitation=true ...");
  const res = await client.callTool({
    name: "append_to_notes",
    arguments: {
      date: "2026-10-12",
      top_themes: ["Fee & charge confusion", "App performance", "Mutual fund usability"],
      weekly_pulse:
        "Key observation: users are surprised by exit load on early mutual fund redemptions. Top themes: fee confusion (28), performance (21), MF UX (17). Action: show fee estimate at redeem step; one-time in-app explainer; smarter support FAQ.",
      identified_fee_issue: "Exit load charged on using some mutual funds is charged upon redemption within 1 year",
      explanation_bullets: [
        "Exit load is charged by the AMC, not the app.",
        "Applies to redemptions within the fund's holding period.",
        "Amount is a % of redemption value, deducted before credit.",
      ],
      source_links: [
        "https://groww.in/help/mutual-funds/order/what-are-the-charges-applicable-for-redeeming--53",
        "https://investor.sebi.gov.in/exit_load.html",
      ],
      approval: { useElicitation: true, approvedBy: "cli-reviewer" },
    } as never,
  });
  console.log(`3) append_to_notes (elicitation) -> ${res.isError ? "REFUSED: " : "OK: "}${textOf(res)}\n`);

  await client.close();
  rl?.close();
}

main().catch((err) => {
  console.error("[cli] Fatal:", err);
  process.exit(1);
});
