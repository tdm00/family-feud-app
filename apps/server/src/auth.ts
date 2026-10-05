import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import cookie from "cookie";
import signature from "cookie-signature";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newToken(): string {
  return randomBytes(32).toString("hex");
}

export function passwordsMatch(given: string, expected: string): boolean {
  const left = Buffer.from(given);
  const right = Buffer.from(expected);
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

export function readHostCookie(header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const raw = cookie.parse(header).host_session;
  if (!raw) return false;
  return signature.unsign(raw, secret) === "ok";
}
