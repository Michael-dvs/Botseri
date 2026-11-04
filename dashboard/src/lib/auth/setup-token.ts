import crypto from "node:crypto";
import { log } from "@/lib/logger";

let generatedToken: string | null = null;

export function getSetupToken(): string {
  if (process.env.SETUP_TOKEN) return process.env.SETUP_TOKEN;
  if (!generatedToken) {
    generatedToken = crypto.randomBytes(24).toString("hex");
    log("WARN", "setup", "SETUP_TOKEN generated for first run", {
      token: generatedToken,
    });
  }
  return generatedToken;
}

export function matchesSetupToken(input: string): boolean {
  const expected = Buffer.from(getSetupToken());
  const actual = Buffer.from(input);
  return (
    expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
  );
}
