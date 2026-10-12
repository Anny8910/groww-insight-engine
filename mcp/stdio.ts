import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createReviewInsightsServer } from "./server";
import { ensureDirs } from "../lib/env";

async function main(): Promise<void> {
  ensureDirs();
  const server = createReviewInsightsServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mcp] Groww Insights MCP server ready on stdio — tools: append_to_notes, create_email_draft, read_notes, read_email_drafts");
}

main().catch((err) => {
  console.error("[mcp] Fatal:", err);
  process.exit(1);
});