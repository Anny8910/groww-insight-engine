import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { runWorkflow } from "@/lib/workflow";
import { ensureDirs, GENERATED_DIR, DEFAULT_REVIEWS_CSV } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Runs the Review Intelligence + Pulse + Fee Explainer steps. Read-only: nothing is written. */
export async function POST(request: NextRequest) {
  let csvPath = DEFAULT_REVIEWS_CSV;
  try {
    const body = await request.json().catch(() => ({}));
    if (typeof body?.reviewsCsv === "string" && body.reviewsCsv.trim().length > 0) {
      ensureDirs();
      const uploadsDir = path.join(GENERATED_DIR, "uploads");
      fs.mkdirSync(uploadsDir, { recursive: true });
      csvPath = path.join(uploadsDir, `upload-${Date.now()}.csv`);
      fs.writeFileSync(csvPath, body.reviewsCsv, "utf8");
    }
  } catch {
    // fall back to default CSV
  }

  const out = await runWorkflow(csvPath);
  return Response.json({ ok: true, ...out });
}