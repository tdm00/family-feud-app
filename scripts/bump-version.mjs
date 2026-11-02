import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "package.json");
const raw = readFileSync(file, "utf8");
const match = raw.match(/"version"\s*:\s*"(\d+)"/);

if (!match) {
  console.error("package.json version must be a whole number");
  process.exit(1);
}

const next = String(Number(match[1]) + 1);
const updated = raw.replace(/"version"\s*:\s*"\d+"/, `"version": "${next}"`);
writeFileSync(file, updated);
console.log(next);
