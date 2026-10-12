# GrowwChat — Review Insight Engine

**Live demo (Vercel):** https://groww-insight-engine.vercel.app

Turns raw customer reviews for **GrowwChat** (a Groww-style investing assistant) into a
weekly product pulse plus a neutral customer-facing fee explainer, then logs the result to
an internal **Notes** document and creates a support/release **email draft** — but only
after an explicit, human **approval** step enforced inside an **MCP server**.

This project focuses on the *RAGs & Context Engineering* brief: retrieval + grounding on a
small, trusted source set, deterministic fee detection, and a guarded write workflow.

> GrowwChat itself is not included in this workspace, so the reviews (`data/reviews.csv`)
> are a synthetic but realistic Groww-style corpus for Jul–Oct 2026.

---

## What it does (pipeline)

1. **Review Intelligence Layer** — loads `data/reviews.csv`, filters to the trailing
   12-week window, and clusters reviews into up to **5 themes** using the LLM
   (deterministic keyword clustering as fallback). Picks verbatim user quotes.
2. **Fee-confusion detection** — scans the window for charge-related terms
   (`exit load`, `AMC`, `DP charges`, `stamp duty`, `brokerage`, `expense ratio`) and
   surfaces the dominant one. **Identified issue: `Exit load`** (34 reviews).
3. **Weekly Product Pulse** — a ≤250-word internal memo (key observation, top themes,
   what users are saying, 3 action ideas).
4. **Fee Explainer** — a short, neutral, jargon-free explanation of the detected fee,
   grounded **only** on the trusted sources in `data/sources.json` (hallucinated links are
   stripped and the real sources are always appended).
5. **Approval gate → MCP writes** — nothing is written until a human approves. On approval:
   - `append_to_notes` appends the entry to the internal Notes doc.
   - `create_email_draft` creates a draft (never sends).

## Where the MCP approval happens

All mutating tools live in the MCP server (`mcp/server.ts`, server name
`review-insights-notes`) and every write must pass through `resolveApproval()`. Two
mechanisms are supported and **both are enforced server-side** — there is no way to write
without one of them:

| Flow | Mechanism | How it works |
| --- | --- | --- |
| Web UI | Signed approval token | The user approves in the UI → `/api/approve` mints an HMAC-SHA256 token (`decisionId:approvedBy:approvedAt:approved`, signed with `APPROVAL_SECRET`) → passed to the tool. The server verifies the signature; a tampered/missing token is refused. |
| CLI | MCP **elicitation** | `npm run mcp:cli` calls a write with `approval.useElicitation=true`. The server sends an elicitation request and the connected client must explicitly accept before the write proceeds. |

Any call without a valid token or elicitation is refused with
`MCP error -32602: Approval required before …` and **no file is written**. Rejecting in the
UI records a rejection and also writes nothing.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in GROQ_API_KEY + APPROVAL_SECRET
```

`GROQ_API_KEY` is only needed for LLM-assisted clustering/drafting; if it is missing or the
free-tier limit is hit, the pipeline falls back to deterministic generators and still produces
complete, valid output.

## Run

```bash
# Full pipeline -> writes deliverables/ (no UI). Performs the signed-token MCP writes.
npm run pipeline

# Interactive web app: Analyze -> Review -> Approve/Reject -> Notes / Email / Rejections
npm run dev            # http://localhost:3000
npm run build && npm start

# MCP approval demo over stdio (refusal without approval, then elicitation)
npm run mcp:cli

# Run the approval-gated MCP server standalone (stdio transport)
npm run mcp:server

# Type-check
npm run typecheck
```

## Deliverables (`deliverables/`)

| File | Description |
| --- | --- |
| `weekly-product-pulse.md` | The ≤250-word weekly pulse. |
| `notes-append-entry.md` / `.json` | Exact entry appended to the internal Notes doc. |
| `email-draft.txt` / `email-draft-subject.txt` | Support/release email draft (not sent). |
| `reviews-sample.csv` | Reviews sample used. |
| `sources.md` | Trusted source list (4–6 URLs). |

Generated runtime state (Notes log, email drafts, pending decisions, rejections) is written
under `data/generated/` (git-ignored).

## Fee issue identified

**Exit load** — users are charged an exit load on early mutual-fund redemptions without a
clear prior explanation. 34 reviews in the window reference it (e.g. *"Money deducted on
redemption without my understanding. I only learned about exit load after contacting
support."*). The engine drafts the pulse around this and produces a grounded, neutral
explainer for support to reuse.

## Deployment

Deployed on **Vercel** (Hobby/free) at <https://groww-insight-engine.vercel.app>.
Required environment variables are set in the Vercel project: `GROQ_API_KEY`,
`APPROVAL_SECRET`, `GROQ_MODEL`, `GROQ_BASE_URL`.

Serverless notes:
- The host filesystem is read-only, so runtime writes (Notes log, email drafts, pending
  decisions) go to `os.tmpdir()` (see `GENERATED_DIR` in `lib/env.ts`). Set `GROWW_DATA_DIR`
  to a persistent volume for durable storage.
- Because `/tmp` is per-instance and ephemeral, the analyze output is carried back to the
  client and forwarded to `/api/approve`; the approval response returns the created Notes
  entry and email draft, which the UI shows in-session. The MCP approval gate is unchanged.

## Project layout

```
data/            reviews.csv, sources.json (inputs)
lib/             llm.ts, reviews.ts, feeDetection.ts, cluster.ts, analyze.ts,
                 pulse.ts, feeExplainer.ts, workflow.ts, store.ts, mcpHost.ts, env.ts, types.ts
mcp/             server.ts (tools + approval gate), stdio.ts (CLI entry)
scripts/         run-pipeline.ts, mcp-cli.ts
app/             Next.js app: page.tsx, api/{analyze,approve,state}
components/      InsightDashboard.tsx
deliverables/    generated assignment outputs
```

## Configuration

| Env var | Purpose |
| --- | --- |
| `GROQ_API_KEY` | Groq API key (OpenAI-compatible endpoint). |
| `GROQ_MODEL` | Primary model (default `openai/gpt-oss-120b`; falls back through `openai/gpt-oss-20b`, `qwen/qwen3.8-27b`). |
| `GROQ_BASE_URL` | Default `https://api.groq.com/openai/v1`. |
| `APPROVAL_SECRET` | HMAC secret used to sign/verify approval tokens. |
| `REVIEWS_CSV` | Path to the reviews CSV (default `data/reviews.csv`). |

> **Note on the LLM:** Groq's free tier enforces tight tokens-per-minute limits, so requests
> are throttled and the pipeline degrades gracefully (LLM → deterministic) per step. The
> reported `clusterMethod` (`llm` vs `keyword`) reflects which path was used.
