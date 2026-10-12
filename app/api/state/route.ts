import { NextRequest } from "next/server";
import { readNotesLog, readEmailDrafts, readRejections } from "@/lib/store";
import { PENDING_DIR } from "@/lib/env";
import fs from "node:fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read-only state: notes doc log, email drafts, rejections, and open decisions. */
export async function GET(_request: NextRequest) {
  let openDecisions = 0;
  if (fs.existsSync(PENDING_DIR)) {
    openDecisions = fs
      .readdirSync(PENDING_DIR)
      .filter((f) => f.endsWith(".json"))
      .filter((f) => {
        try {
          const p = JSON.parse(fs.readFileSync(`${PENDING_DIR}/${f}`, "utf8"));
          return p?.status === "open";
        } catch {
          return false;
        }
      }).length;
  }

  return Response.json({
    ok: true,
    notes: readNotesLog(),
    emailDrafts: readEmailDrafts(),
    rejections: readRejections(),
    openDecisions,
  });
}