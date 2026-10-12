import fs from "node:fs";
import Papa from "papaparse";
import type { Review } from "./types";
import { DEFAULT_REVIEWS_CSV } from "./env";

/** Number of calendar weeks back from "today" to consider as the review window. */
export const REVIEW_WINDOW_WEEKS = 12;

function normalizeReviewRow(raw: Record<string, string>): Review | null {
  const text = (raw.text ?? "").trim();
  const title = (raw.title ?? "").trim();
  if (!text && !title) return null;
  const rating = Number(raw.rating);
  return {
    reviewId: (raw.review_id || raw.reviewId || "R000").trim(),
    date: (raw.date || raw.review_date || "").trim(),
    rating: Number.isFinite(rating) ? Math.max(1, Math.min(5, rating)) : 3,
    title,
    text,
    appVersion: (raw.app_version || raw.version || "").trim(),
  };
}

export function parseCsv(content: string): Review[] {
  const result = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: "greedy",
  });
  const rows = (result.data ?? [])
    .filter((r) => r && typeof r === "object")
    .map(normalizeReviewRow)
    .filter((r): r is Review => r !== null);
  return rows.filter(
    (r) => r.text.length > 0 || r.title.length > 0,
  );
}

export function loadReviews(csvPath = DEFAULT_REVIEWS_CSV): Review[] {
  const content = fs.readFileSync(csvPath, "utf8");
  return parseCsv(content);
}

function parseDateIso(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Returns reviews within the last N calendar weeks, newest first. */
export function filterRecentWindow(
  reviews: Review[],
  weeks = REVIEW_WINDOW_WEEKS,
  fromDate = new Date(),
): Review[] {
  const dayMs = 86_400_000;
  const cutoff = new Date(fromDate.getTime() - weeks * 7 * dayMs);
  return reviews
    .filter((r) => {
      const d = parseDateIso(r.date);
      if (!d) return true; // keep undated reviews
      return d.getTime() >= cutoff.getTime() && d.getTime() <= fromDate.getTime();
    })
    .sort((a, b) => (b.date < a.date ? -1 : a.date < b.date ? 1 : 0));
}

export function windowBounds(reviews: Review[]): { start: string; end: string } {
  const dates = reviews
    .map((r) => parseDateIso(r.date)?.getTime())
    .filter((v): v is number => v !== undefined && v !== null);
  if (dates.length === 0) {
    const now = new Date();
    const start = new Date(now.getTime() - 84 * 86_400_000);
    return { start: start.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
  }
  return {
    start: new Date(Math.min(...dates)).toISOString().slice(0, 10),
    end: new Date(Math.max(...dates)).toISOString().slice(0, 10),
  };
}