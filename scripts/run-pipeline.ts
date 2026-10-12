/**
 * Runs the full GrowwChat review-insights workflow and produces the assignment
 * deliverables. It ALSO performs the two MCP actions (append_to_notes and
 * create_email_draft) through a REAL MCP client/server pair. The approval step
 * is executed here with a signed approval token (this script stands in for an
 * approving human; in the web UI the same token is minted only after the
 * Approve button is clicked).
 *
 * Run: npm run pipeline
 */
import fs from "node:fs";
import path from "node:path";
import { loadLocalEnv } from "../lib/loadEnv";
import { runWorkflow, weekLabel } from "../lib/workflow";
import {
  nowIso,
  signApprovalToken,
  today,
  DEFAULT_REVIEWS_CSV,
  ROOT_DIR,
  ensureDirs,
} from "../lib/env";
import { withMcpClient } from "../lib/mcpHost";
import type { NotesEntry } from "../lib/types";

async function main(): Promise<void> {
  loadLocalEnv();
  ensureDirs();

  const out = await runWorkflow(DEFAULT_REVIEWS_CSV);
  const { insights, pulse, feeExplanation, decisionId, weeklyPulseMarkdown } = out;

  console.log("\n=== REVIEW INTELLIGENCE ===\n");
  console.log(`Window: ${insights.windowStart} → ${insights.windowEnd} (${insights.reviewCount} reviews), method=${insights.clusterMethod}`);
  console.log(`Clusters (max 5):`);
  for (const t of insights.themes) {
    console.log(`  [${t.id}] ${t.name} — ${t.reviewIds.length} reviews — ${t.description}`);
  }
  console.log("\nTop 3 themes:");
  insights.topThree.forEach((t, i) => console.log(`  ${i + 1}. ${t.name} (${t.reviewIds.length})`));

  console.log("\nUser quotes:");
  insights.quotes.forEach((q) => console.log(`  - [${q.theme}] ${q.text}`));

  console.log("\nFee confusion detected:");
  console.log(`  ${insights.feeIssue.label}: ${insights.feeIssue.description}`);
  console.log(`  painCount=${insights.feeIssue.painCount}`);
  insights.feeIssue.sampleQuotes.slice(0, 3).forEach((q) => console.log(`    - "${q}"`));

  console.log("\n=== WEEKLY PRODUCT PULSE ===\n");
  console.log(weeklyPulseMarkdown);
  console.log(`\n[word count: ${pulse.wordCount}]`);

  console.log("\n=== FEE EXPLAINER ===\n");
  feeExplanation.bullets.forEach((b) => console.log(`  - ${b}`));
  console.log(`  Source links: ${feeExplanation.sourceLinks.map((s) => s.url).join(" | ")}`);
  console.log(`  Last checked: ${feeExplanation.lastChecked}`);

  // ---- MCP actions with approval ----
  console.log("\n=== MCP ACTIONS (approval gated) ===\n");
  const approvedBy = "pipeline-run";
  const approvedAt = nowIso();
  const approvalToken = signApprovalToken({ decisionId, approvedBy, approvedAt });

  const notesEntry: NotesEntry = {
    date: today(),
    top_themes: insights.topThree.map((t) => `${t.name} (${t.reviewIds.length})`),
    weekly_pulse: pulse.summary,
    identified_fee_issue: `${insights.feeIssue.label} — ${insights.feeIssue.description}`,
    explanation_bullets: feeExplanation.bullets,
    source_links: feeExplanation.sourceLinks.map((s) => s.url),
    decisionId,
    approvedBy,
  };

  const subject = `Weekly Product Pulse + Customer Clarification — ${weekLabel(insights)}`;
  const emailBody = [
    "Subject: " + subject,
    "",
    "Weekly product pulse",
    weeklyPulseMarkdown,
    "",
    "Fee explanation (reusable support snippet)",
    feeExplanation.bullets.map((b) => `- ${b}`).join("\n"),
    feeExplanation.sourceLinks.map((s) => `- ${s.title} (${s.url})`).join("\n"),
    `Last checked: ${feeExplanation.lastChecked}`,
    "",
    "(Draft only — no auto-send)",
  ].join("\n");

  const mcpResult = await withMcpClient(async (host) => {
    const appendRes = await host.call("append_to_notes", {
      ...notesEntry,
      approval: { decisionId, approvedBy, approvedAt, approvalToken },
    });
    const emailRes = await host.call("create_email_draft", {
      subject,
      to: "support-leads@growwchat.dev",
      pulse_text: weeklyPulseMarkdown,
      fee_explainer_bullets: feeExplanation.bullets,
      source_links: feeExplanation.sourceLinks.map((s) => `- ${s.title} (${s.url})`),
      approval: { decisionId, approvedBy, approvedAt, approvalToken },
    });
    const notes = (await host.call("read_notes", {})) as { entries: NotesEntry[] };
    const drafts = await host.call("read_email_drafts", {});
    return { appendRes, emailRes, notes, drafts };
  });

  console.log(`1. append_to_notes -> ${JSON.stringify(mcpResult.appendRes)}`);
  console.log(`2. create_email_draft -> ${JSON.stringify(mcpResult.emailRes)}`);

  // ---- Write deliverables ----
  const deliverablesDir = path.join(ROOT_DIR, "deliverables");
  fs.mkdirSync(deliverablesDir, { recursive: true });

  fs.writeFileSync(
    path.join(deliverablesDir, "weekly-product-pulse.md"),
    weeklyPulseMarkdown + "\n",
    "utf8",
  );

  const latestEntry = (mcpResult.notes.entries ?? [])[mcpResult.notes.entries.length - 1];
  const entrySnippet = `## Notes/Doc appended entry — decisionId ${latestEntry?.decisionId}\n\n\`\`\`json\n${JSON.stringify(latestEntry, null, 2)}\n\`\`\`\n`;
  fs.writeFileSync(path.join(deliverablesDir, "notes-append-entry.md"), entrySnippet, "utf8");
  fs.writeFileSync(
    path.join(deliverablesDir, "notes-append-entry.json"),
    JSON.stringify(latestEntry, null, 2) + "\n",
    "utf8",
  );

  const draftsArr = (mcpResult.drafts as { drafts: Array<{ filename: string; subject: string; body: string }> }).drafts;
  const latestDraft = draftsArr[draftsArr.length - 1];
  fs.writeFileSync(
    path.join(deliverablesDir, "email-draft.txt"),
    latestDraft.body + "\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(deliverablesDir, "email-draft-subject.txt"),
    latestDraft.subject + "\n",
    "utf8",
  );

  fs.copyFileSync(
    DEFAULT_REVIEWS_CSV,
    path.join(deliverablesDir, "reviews-sample.csv"),
  );

  const sourcesMd = [
    "# Source list",
    "",
    `Product: ${process.env.PRODUCT_NAME ?? "Groww Chat (Groww-style investing assistant)"}`,
    "",
    "| # | Title | URL | Type |",
    "|---| ----- | --- | ---- |",
  ];
  const sourcesJson = JSON.parse(
    fs.readFileSync(path.join(ROOT_DIR, "data", "sources.json"), "utf8"),
  ) as { sources: { title: string; url: string; type: string }[] };
  sourcesJson.sources.forEach((s, i) => {
    sourcesMd.push(`| ${i + 1} | ${s.title} | ${s.url} | ${s.type} |`);
  });
  fs.writeFileSync(path.join(deliverablesDir, "sources.md"), sourcesMd.join("\n") + "\n", "utf8");

  console.log("\n=== DELIVERABLES WRITTEN ===");
  for (const f of fs.readdirSync(deliverablesDir)) {
    console.log(`  deliverables/${f}`);
  }
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("[pipeline] Fatal:", err);
  process.exit(1);
});