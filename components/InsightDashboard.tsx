"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FeeExplanation, Insights, NotesEntry, Theme, WeeklyPulse } from "@/lib/types";

interface EmailDraftShape {
  filename: string;
  subject: string;
  to: string;
  body: string;
}

interface WorkflowOutput {
  decisionId: string;
  insights: Insights;
  pulse: WeeklyPulse;
  feeExplanation: FeeExplanation;
  weeklyPulseMarkdown: string;
}

interface StateShape {
  notes: NotesEntry[];
  emailDrafts: EmailDraftShape[];
  rejections: Array<{ decisionId: string; approvedBy: string; rejectedAt: string }>;
}

type Phase = "idle" | "running" | "ready" | "approving" | "done" | "rejected" | "error";

const statusLabel: Record<string, string> = {
  idle: "Idle — nothing generated yet",
  running: "Running review intelligence (clustering + drafting)…",
  ready: "Outputs ready — review before approving",
  approving: "Processing approval via MCP…",
  done: "Approved — appended to Notes & email draft created (no auto-send)",
  rejected: "Rejected — no tools were called, nothing written",
  error: "Something went wrong",
};

export default function InsightDashboard() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [working, setWorking] = useState<WorkflowOutput | null>(null);
  const [decisionResult, setDecisionResult] = useState<Record<string, unknown> | null>(null);
  const [approvedBy, setApprovedBy] = useState("Dev User");
  const [csvName, setCsvName] = useState("data/reviews.csv (default)");
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<StateShape>({ notes: [], emailDrafts: [], rejections: [] });
  const [sessionNotes, setSessionNotes] = useState<NotesEntry[]>([]);
  const [sessionDrafts, setSessionDrafts] = useState<EmailDraftShape[]>([]);
  const [sessionRejections, setSessionRejections] = useState<
    Array<{ decisionId: string; approvedBy: string; rejectedAt: string }>
  >([]);
  const [tab, setTab] = useState<"notes" | "email" | "rejections">("notes");

  const refreshState = useCallback(async () => {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      const data = (await res.json()) as StateShape;
      setState(data);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  const runAnalysis = async () => {
    setPhase("running");
    setError("");
    let reviewsCsv: string | undefined;
    if (file) {
      reviewsCsv = await file.text();
      setCsvName(file.name);
    } else {
      setCsvName("data/reviews.csv (default sample)");
    }
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reviewsCsv ? { reviewsCsv } : {}),
      });
      const json = (await res.json()) as WorkflowOutput;
      if (!res.ok) throw new Error((json as { error?: string }).error ?? res.statusText);
      setWorking(json);
      setDecisionResult(null);
      setPhase("ready");
    } catch (err) {
      setError((err as Error).message);
      setPhase("error");
    }
  };

  const decide = async (decision: "approve" | "reject") => {
    if (!working) return;
    setPhase("approving");
    setError("");
    try {
      const res = await fetch("/api/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisionId: working.decisionId, decision, approvedBy, pending: working }),
      });
      const json = (await res.json()) as Record<string, any>;
      if (!res.ok) throw new Error((json as { error?: string }).error ?? res.statusText);
      setDecisionResult(json);
      if (json.status === "approved") {
        if (json.notesEntry) setSessionNotes((p) => [...p, json.notesEntry as NotesEntry]);
        if (json.emailDraft) setSessionDrafts((p) => [...p, json.emailDraft as EmailDraftShape]);
      } else if (json.status === "rejected") {
        setSessionRejections((p) => [
          ...p,
          {
            decisionId: working.decisionId,
            approvedBy,
            rejectedAt: String(json.rejectedAt ?? new Date().toISOString()),
          },
        ]);
      }
      setPhase(json.status === "rejected" ? "rejected" : "done");
      await refreshState();
    } catch (err) {
      setError((err as Error).message);
      setPhase("error");
    }
  };

  // Merge the in-session results with any server-persisted state (best-effort on serverless).
  const notes = useMemo(() => {
    const seen = new Set<string>();
    return [...sessionNotes, ...state.notes].filter((n) => {
      const key = n.decisionId ?? n.appendedAt ?? JSON.stringify(n).slice(0, 48);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [sessionNotes, state.notes]);

  const emailDrafts = useMemo(() => {
    const seen = new Set<string>();
    return [...sessionDrafts, ...state.emailDrafts].filter((d) => {
      if (seen.has(d.filename)) return false;
      seen.add(d.filename);
      return true;
    });
  }, [sessionDrafts, state.emailDrafts]);

  const rejections = useMemo(() => {
    const seen = new Set<string>();
    return [...sessionRejections, ...state.rejections].filter((r) => {
      if (seen.has(r.decisionId)) return false;
      seen.add(r.decisionId);
      return true;
    });
  }, [sessionRejections, state.rejections]);

  const latestNotesCount = notes.length;

  const payloadPreview = useMemo(() => {
    if (!working) return "";
    return JSON.stringify(
      {
        date: new Date().toISOString().slice(0, 10),
        top_themes: working.insights.topThree.map((t) => `${t.name} (${t.reviewIds.length})`),
        weekly_pulse: working.pulse.summary,
        identified_fee_issue: working.insights.feeIssue.label,
        explanation_bullets: working.feeExplanation.bullets,
        source_links: working.feeExplanation.sourceLinks.map((s) => s.url),
      },
      null,
      2,
    );
  }, [working]);

  const insights = working?.insights;
  const topThemeNames = useMemo(
    () => (insights?.topThree ?? []).map((t) => t.name).join(" · "),
    [insights?.topThree],
  );

  return (
    <div className="app">
      <div className="topbar">
        <div className="logo">
          Groww<span>Chat</span> <em>Insight Engine</em>
        </div>
        <div className="tag">Reviews → Themes → Pulse → Fee Explainer → Approved MCP writes</div>
      </div>
      <p className="subhead">
        Simulates a Product + Support workflow: cluster user reviews into themes, surface a
        recurring fee confusion, draft a weekly pulse and a neutral fee explainer, then log to
        internal tools through approval-gated MCP. Nothing is written until you approve.
      </p>

      <div className="grid">
        {/* ---------- Step 1 + 2 ---------- */}
        <div className="card span2">
          <div className="stepflow">
            <div className={`dot ${phase === "running" ? "wait" : "done"}`}>1</div>
            <div className={`dot ${phase === "ready" || phase === "done" ? "done" : ""}`}>2</div>
            <div className={`dot ${phase === "approving" ? "wait" : phase === "done" ? "done" : ""}`}>3</div>
          </div>
          <h2>Review Intelligence Layer</h2>
          <p className="desc">
            Input: public reviews CSV (default <code>data/reviews.csv</code>, last 12 weeks).
            Clusters into ≤5 themes, ranks the top 3, extracts 3 real quotes, and pinpoints the
            recurring fee/charge confusion.
          </p>
          <div className="row">
            <label className="pill" style={{ cursor: "pointer" }}>
              Upload own CSV
              <input
                type="file"
                accept=".csv,text/csv"
                hidden
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            {file && <span className="meta">{file.name}</span>}
            <span className="spacer" />
            <button
              className="btn primary"
              disabled={phase === "running" || phase === "approving"}
              onClick={runAnalysis}
            >
              {phase === "running" ? "Analyzing…" : "Run review intelligence"}
            </button>
          </div>
          <div style={{ marginTop: 12 }}>
            <span className="meta">Source: {csvName}</span>
            {phase === "running" && <div className="skeleton"> Clustering + drafting (LLM)…</div>}
            {error && <div className="banner rejected"><h4>Error</h4><p>{error}</p></div>}
          </div>

          {insights && (
            <div style={{ marginTop: 14 }}>
              <div className="row">
                <span className="pill good">Method: {insights.clusterMethod}</span>
                <span className="pill">Window: {insights.windowStart} → {insights.windowEnd}</span>
                <span className="pill">{insights.reviewCount} reviews</span>
                <span className="pill">Clusters: {insights.themes.length}/5</span>
              </div>

              <ul className="theme-list">
                {insights.topThree.map((t: Theme, i: number) => (
                  <li className="theme-item" key={t.id}>
                    <div className="t-head">
                      <span>#{i + 1} · {t.name}</span>
                      <span className="t-count">{t.reviewIds.length} reviews</span>
                    </div>
                    <div className="t-desc">{t.description}</div>
                    {t.quoteIds.slice(0, 2).map((id) => {
                      const q = insights.quotes.find((x) => x.reviewId === id);
                      return q ? (
                        <div className="quote" style={{ marginTop: 8 }} key={id}>
                          “{q.text}”
                          <small>{q.reviewId} · {q.date}</small>
                        </div>
                      ) : null;
                    })}
                  </li>
                ))}
                {insights.themes.length > 3 &&
                  insights.themes.slice(3).map((t: Theme) => (
                    <li className="theme-item" key={t.id}>
                      <div className="t-head">
                        <span>{t.name}</span>
                        <span className="t-count">{t.reviewIds.length} reviews</span>
                      </div>
                    </li>
                  ))}
              </ul>

              <div className="banner" style={{ marginTop: 14 }}>
                <h4>Recurring fee/charge confusion — {insights.feeIssue.label}</h4>
                <p>{insights.feeIssue.description}</p>
                <small>
                  {insights.feeIssue.painCount} reviews reference this charge.
                  {insights.feeIssue.sampleQuotes.slice(0, 2).map((q, i) => (
                    <span key={i}> “{q}”</span>
                  ))}
                </small>
              </div>
            </div>
          )}
        </div>

        {/* ---------- Step 2 outputs ---------- */}
        {working && (
          <>
            <div className="card">
              <div className="step">Step 2 · output 1</div>
              <h2>Weekly Product Pulse</h2>
              <p className="desc">
                ≤250 words · structured weekly note for the internal product team.
                <span className="pill" style={{ marginLeft: 8 }}>{working.pulse.wordCount} words</span>
              </p>
              {working.pulse.keyObservation && (
                <div className="skeleton" style={{ marginBottom: 6 }}>
                  <strong>Key observation:</strong> {working.pulse.keyObservation}
                </div>
              )}
              <pre className="raw">{working.pulse.summary}</pre>
            </div>

            <div className="card">
              <div className="step">Step 2 · output 2</div>
              <h2>Fee Explainer</h2>
              <p className="desc">
                {working.feeExplanation.feeName} — neutral, facts-only, ≤6 bullets.
              </p>
              <ul className="fee-bullets">
                {working.feeExplanation.bullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
              <div className="meta" style={{ marginTop: 10 }}>
                Source links:
                {working.feeExplanation.sourceLinks.map((s) => (
                  <span key={s.url} style={{ display: "block" }}>
                    {s.title} — <a href={s.url} target="_blank" rel="noreferrer">{s.url}</a>
                  </span>
                ))}
                <br />
                Last checked: {working.feeExplanation.lastChecked}
              </div>
            </div>
          </>
        )}

        {/* ---------- Step 3 approval ---------- */}
        {working && (
          <div className="card span2">
            <div className="step">Step 3 · approval-gated MCP</div>
            <h2>Review before distributing to internal tools</h2>
            <p className="desc">
              Previewing exactly what will be appended to the Notes/Doc and included in the email
              draft. Both MCP tools (<code>append_to_notes</code>, <code>create_email_draft</code>)
              require a signed approval. No auto-send.
            </p>

            <div className="approval-box">
              <strong>Will append to Notes/Doc (decision #{working.decisionId}):</strong>
              <pre className="raw" style={{ maxHeight: 260 }}>{payloadPreview}</pre>
              <div className="skeleton" style={{ marginTop: 8 }}>
                Top themes: <strong>{topThemeNames}</strong>
              </div>
            </div>

            <div className="row" style={{ marginTop: 16 }}>
              <label className="pill">
                Approved by
                <input
                  value={approvedBy}
                  onChange={(e) => setApprovedBy(e.target.value)}
                  style={{ marginLeft: 6, background: "transparent", border: "none", color: "var(--text)", outline: "none", borderBottom: "1px solid var(--line)" }}
                />
              </label>
              <span className="spacer" />
              <button className="btn danger" disabled={phase === "approving" || phase === "done" || phase === "rejected"} onClick={() => decide("reject")}>
                Reject (write nothing)
              </button>
              <button className="btn primary" disabled={phase === "approving" || phase === "done" || phase === "rejected"} onClick={() => decide("approve")}>
                {phase === "approving" ? "Calling MCP…" : "Approve & log to Notes + draft email"}
              </button>
            </div>
            <div style={{ marginTop: 10 }}>
              <span className={`pill ${phase === "done" ? "good" : ""}`}>{statusLabel[phase]}</span>
              {decisionResult && (
                <div style={{ marginTop: 10 }}>
                  {decisionResult.status === "approved" && (
                    <pre className="raw" style={{ maxHeight: 220 }}>
                      {JSON.stringify(decisionResult.mcp ?? decisionResult, null, 2)}
                    </pre>
                  )}
                  {(decisionResult as { message?: string }).message && (
                    <div className="skeleton" style={{ marginTop: 6 }}>
                      {(decisionResult as { message?: string }).message}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ---------- Step 4 internal tools log ---------- */}
        <div className="card span2">
          <div className="step">Internal tools · state</div>
          <h2>Notes/Doc, Email drafts & decision log</h2>
          <p className="desc">
            Read-only view of what has been written through the MCP tools
            (entries:{latestNotesCount} · drafts:{emailDrafts.length} · rejections:{rejections.length})
          </p>
          <div className="tabs">
            <button className={tab === "notes" ? "active" : ""} onClick={() => setTab("notes")}>Notes/Doc ({notes.length})</button>
            <button className={tab === "email" ? "active" : ""} onClick={() => setTab("email")}>Email drafts ({emailDrafts.length})</button>
            <button className={tab === "rejections" ? "active" : ""} onClick={() => setTab("rejections")}>Rejections ({rejections.length})</button>
          </div>

          {tab === "notes" &&
            (notes.length === 0 ? (
              <div className="skeleton">Nothing appended yet — approve Step 3 to append your first Notes entry.</div>
            ) : (
              notes.map((n, i) => (
                <div className="log-entry" key={i}>
                  <div className="l-head">
                    <span>{n.date} · {n.identified_fee_issue?.split("—")[0].trim()}</span>
                    <span>#{(latestNotesCount - notes.length + i + 1)} of {latestNotesCount} · {n.decisionId ?? ""}</span>
                  </div>
                  <pre>{JSON.stringify(n, null, 2)}</pre>
                </div>
              ))
            ))}

          {tab === "email" &&
            (emailDrafts.length === 0 ? (
              <div className="skeleton">No email drafts yet.</div>
            ) : (
              emailDrafts.map((d) => (
                <div className="log-entry" key={d.filename}>
                  <div className="l-head">
                    <span>To: {d.to}</span>
                    <span>Subject: {d.subject}</span>
                  </div>
                  <pre>{d.body}</pre>
                </div>
              ))
            ))}

          {tab === "rejections" &&
            (rejections.length === 0 ? (
              <div className="skeleton">No rejected decisions yet.</div>
            ) : (
              rejections.map((r, i) => (
                <div className="log-entry" key={i}>
                  <div className="l-head">
                    <span>Decision {r.decisionId} rejected</span>
                    <span>{r.rejectedAt}</span>
                  </div>
                  <pre>Decision rejected — no MCP write tools were called, nothing was written.</pre>
                </div>
              ))
            ))}
          <div style={{ marginTop: 8 }}>
            <button className="btn ghost" onClick={refreshState}>Refresh state</button>
          </div>
        </div>
      </div>
    </div>
  );
}