import crypto from "node:crypto";

export const ACTIVE_STATUSES = ["PENDING", "IN_PROGRESS"] as const;

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildDedupeKey(
  sourceMessageId: string | null,
  title: string,
  dueAt: Date | null,
): string | null {
  if (!sourceMessageId) return null;
  return crypto
    .createHash("sha1")
    .update(
      `${sourceMessageId}|${title.toLowerCase().trim()}|${dueAt?.toISOString() ?? ""}`,
    )
    .digest("hex");
}

type Candidate = { id: string; title: string };

export type FuzzyResult = {
  matches: Array<{ id: string; title: string; score: number }>;
  ambiguous: boolean;
};

export function fuzzyMatch(
  text: string,
  candidates: Candidate[],
): FuzzyResult {
  const query = normalizeText(text);
  const tokens = query.split(" ").filter((token) => token.length > 1);

  const matches = candidates
    .map((candidate) => {
      const title = normalizeText(candidate.title);
      let score = 0;
      if (title.includes(query)) score += 3;
      for (const token of tokens) {
        if (title.includes(token)) score += 1;
      }
      return { ...candidate, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

  const ambiguous =
    matches.length > 1 &&
    matches[0].score === matches[1].score &&
    matches[0].score > 0;

  return { matches, ambiguous };
}
