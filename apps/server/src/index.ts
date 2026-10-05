import { existsSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { createApp } from "./app.js";

for (const file of [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "../../.env")]) {
  if (existsSync(file)) dotenv.config({ path: file });
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function resolveDbPath(value: string | undefined): string {
  if (value && path.isAbsolute(value)) return value;
  const root = existsSync(path.resolve(process.cwd(), "pnpm-workspace.yaml"))
    ? process.cwd()
    : path.resolve(process.cwd(), "../..");
  return path.resolve(root, value ?? "data/feud.sqlite");
}

const port = Number(process.env.PORT ?? 3000);
const { app } = await createApp({
  dbPath: resolveDbPath(process.env.DATABASE_PATH),
  hostPassword: required("HOST_PASSWORD"),
  roomCode: required("ROOM_CODE"),
  sessionSecret: required("SESSION_SECRET"),
  secureCookie: process.env.NODE_ENV === "production",
  logger: process.env.NODE_ENV !== "test",
});

await app.listen({ port, host: "0.0.0.0" });
