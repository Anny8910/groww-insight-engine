import fs from "node:fs";
import path from "node:path";

/** Lightweight .env.local loader for tsx scripts (Next loads it automatically). */
export function loadLocalEnv(file = path.join(process.cwd(), ".env.local")): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const [, key, value] = m;
    if (!(key in process.env)) {
      process.env[key] = value.replace(/^["']|["']$/g, "");
    }
  }
}