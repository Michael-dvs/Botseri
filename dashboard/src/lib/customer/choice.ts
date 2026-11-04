export type CustomerChoice = "ORDER" | "ASK" | "UNKNOWN";

/**
 * Parses user input in AWAITING_CHOICE state.
 * - ORDER: text (trimmed) is exactly '1', or contains 'pesan', 'order', 'beli'.
 * - ASK: text is exactly '2', or contains 'tanya', 'konsultasi', 'nanya'.
 * - If both match or neither matches -> UNKNOWN.
 */
export function parseChoice(
  text: string | undefined | null,
  customOrderKeywords?: string[],
  customAskKeywords?: string[]
): CustomerChoice {
  if (!text) return "UNKNOWN";
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  const isExact1 = lower === "1";
  const isExact2 = lower === "2";

  const orderList =
    customOrderKeywords && customOrderKeywords.length > 0
      ? customOrderKeywords
      : ["1", "pesan", "order", "beli"];

  const askList =
    customAskKeywords && customAskKeywords.length > 0
      ? customAskKeywords
      : ["2", "tanya", "konsul", "konsultasi", "nanya", "info"];

  const matchesOrder = orderList.some((kw) => {
    const k = kw.trim().toLowerCase();
    return lower === k || new RegExp(`\\b${k}\\b`, "i").test(lower);
  });

  const matchesAsk = askList.some((kw) => {
    const k = kw.trim().toLowerCase();
    return lower === k || new RegExp(`\\b${k}\\b`, "i").test(lower);
  });

  const isOrder = isExact1 || matchesOrder;
  const isAsk = isExact2 || matchesAsk;

  if (isOrder && isAsk) return "UNKNOWN";
  if (isOrder) return "ORDER";
  if (isAsk) return "ASK";
  return "UNKNOWN";
}
