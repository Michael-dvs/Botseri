import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../../");
const SCRIPT_PATH = path.join(REPO_ROOT, "scripts/check-secrets.sh");

describe("scripts/check-secrets.sh (Secret Scanner)", () => {
  it("returns exit code 0 on clean repository", () => {
    const output = execSync(`bash "${SCRIPT_PATH}"`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });

    expect(output).toContain("Pemeriksaan rahasia BERHASIL");
  });

  it("returns exit code 1 and masks secret value when an OpenAI key pattern is detected", () => {
    const tempFile = path.join(REPO_ROOT, "temp-test-leak.txt");
    try {
      fs.writeFileSync(tempFile, "const apiKey = 'sk-fakeopenai1234567890abcdef';\n", "utf8");

      let errorThrown = false;
      let stderrOutput = "";

      try {
        execSync(`bash "${SCRIPT_PATH}"`, {
          cwd: REPO_ROOT,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (err: unknown) {
        errorThrown = true;
        const execErr = err as { status: number; stderr: string; stdout: string };
        expect(execErr.status).toBe(1);
        stderrOutput = execErr.stderr;
      }

      expect(errorThrown).toBe(true);
      expect(stderrOutput).toContain("[PERINGATAN] Potensi rahasia terdeteksi di: temp-test-leak.txt");
      expect(stderrOutput).toContain("(nilai disamarkan demi keamanan)");
      expect(stderrOutput).not.toContain("sk-fakeopenai1234567890abcdef");
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });

  it("returns exit code 1 when Google API key or ENCRYPTION_KEY pattern is detected", () => {
    const tempFile = path.join(REPO_ROOT, "temp-test-gemini-leak.txt");
    try {
      fs.writeFileSync(tempFile, "GOOGLE_KEY=AIzaSyFakeGoogleKey1234567890abcdef\nENCRYPTION_KEY=123456789012345678901234567890==\n", "utf8");

      let errorThrown = false;
      let stderrOutput = "";

      try {
        execSync(`bash "${SCRIPT_PATH}"`, {
          cwd: REPO_ROOT,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (err: unknown) {
        errorThrown = true;
        const execErr = err as { status: number; stderr: string };
        expect(execErr.status).toBe(1);
        stderrOutput = execErr.stderr;
      }

      expect(errorThrown).toBe(true);
      expect(stderrOutput).toContain("[PERINGATAN] Potensi rahasia terdeteksi di: temp-test-gemini-leak.txt");
      expect(stderrOutput).not.toContain("AIzaSyFakeGoogleKey1234567890abcdef");
      expect(stderrOutput).not.toContain("123456789012345678901234567890==");
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });
});
