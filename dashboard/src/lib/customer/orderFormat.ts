export interface OrderDraft {
  nama_pemesan?: string;
  jenis_pesanan?: string;
  tanggal_acara?: string;
  parsed_date?: Date | null;
  jam_pengiriman?: string;
  alamat?: string;
  request_khusus?: string;
}

export type RequiredField =
  | "nama_pemesan"
  | "jenis_pesanan"
  | "tanggal_acara"
  | "alamat";

const ORDER_FORM_LABELS = [
  "nama pemesan",
  "jenis pesanan",
  "tanggal acara",
  "jam pengiriman",
  "alamat",
  "request khusus",
  "format pesanan berseri",
] as const;

/**
 * Checks whether incoming message looks like an order form (Decision D4).
 * Returns true if text contains at least 3 recognized labels.
 */
export function looksLikeOrderForm(text: string | undefined | null): boolean {
  if (!text) return false;
  const normalized = text.toLowerCase().replace(/\s+/g, " ");

  let matchCount = 0;
  for (const label of ORDER_FORM_LABELS) {
    if (normalized.includes(label)) {
      matchCount += 1;
    }
  }

  return matchCount >= 3;
}

const MONTH_MAP: Record<string, number> = {
  januari: 1, jan: 1,
  februari: 2, pebruari: 2, feb: 2, peb: 2,
  maret: 3, mar: 3,
  april: 4, apr: 4,
  mei: 5, may: 5,
  juni: 6, jun: 6,
  juli: 7, jul: 7,
  agustus: 8, agt: 8, ags: 8, aug: 8,
  september: 9, sept: 9, sep: 9,
  oktober: 10, okt: 10, oct: 10,
  november: 11, nopember: 11, nov: 11, nop: 11,
  desember: 12, des: 12, dec: 12,
};

/**
 * Parses date string in Indonesian/standard format in Asia/Jakarta timezone.
 * Returns null if ambiguous, invalid, or impossible date.
 */
export function parseDateId(value: string | undefined | null): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Pattern 1: DD Month YYYY (e.g. 15 November 2026, 15 nov 2026)
  const textMonthRegex = /^(\d{1,2})[\s\-\/\.]([a-zA-Z]+)[\s\-\/\.](\d{4})$/;
  const textMatch = trimmed.match(textMonthRegex);
  if (textMatch) {
    const day = parseInt(textMatch[1], 10);
    const monthStr = textMatch[2].toLowerCase();
    const year = parseInt(textMatch[3], 10);
    const month = MONTH_MAP[monthStr];
    if (month) {
      return buildJakartaDate(year, month, day);
    }
  }

  // Pattern 2: DD-MM-YYYY or DD/MM/YYYY or DD.MM.YYYY
  const numDmyRegex = /^(\d{1,2})[\-\/\.](\d{1,2})[\-\/\.](\d{4})$/;
  const dmyMatch = trimmed.match(numDmyRegex);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10);
    const year = parseInt(dmyMatch[3], 10);
    return buildJakartaDate(year, month, day);
  }

  // Pattern 3: YYYY-MM-DD (ISO date)
  const ymdRegex = /^(\d{4})[\-\/\.](\d{1,2})[\-\/\.](\d{1,2})$/;
  const ymdMatch = trimmed.match(ymdRegex);
  if (ymdMatch) {
    const year = parseInt(ymdMatch[1], 10);
    const month = parseInt(ymdMatch[2], 10);
    const day = parseInt(ymdMatch[3], 10);
    return buildJakartaDate(year, month, day);
  }

  return null;
}

function buildJakartaDate(year: number, month: number, day: number): Date | null {
  if (year < 2020 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  // Validate days in month
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;

  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  const isoStr = `${year}-${mm}-${dd}T00:00:00+07:00`;
  const date = new Date(isoStr);
  return isNaN(date.getTime()) ? null : date;
}

function cleanFieldValue(raw: string): string | undefined {
  let val = raw.trim();
  // Strip leading bullets and separators
  val = val.replace(/^[•\-\*\_\:\s]+/, "").trim();
  // Strip trailing markdown formatting
  val = val.replace(/[\*_]+$/, "").trim();

  // If value is empty or just placeholder
  if (!val || val === "-" || val === "--" || val === "." || val.toLowerCase() === "null") {
    return undefined;
  }
  return val;
}

/**
 * Deterministic label-based parser for order forms.
 */
export function parseOrderForm(text: string): {
  fields: Partial<OrderDraft>;
  missing: RequiredField[];
} {
  const fields: Partial<OrderDraft> = {};
  if (!text) {
    return {
      fields,
      missing: ["nama_pemesan", "jenis_pesanan", "tanggal_acara", "alamat"],
    };
  }

  // 1. Strip introductory text before FORMAT PESANAN BERSERI if present
  let sanitizedText = text;
  const headerIdx = sanitizedText.search(/\*?FORMAT PESANAN BERSERI\*?/i);
  if (headerIdx !== -1) {
    sanitizedText = sanitizedText.slice(headerIdx);
  }

  const lines = sanitizedText.split("\n");
  let currentKey: keyof OrderDraft | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/salin dan isi/i.test(line)) {
      currentKey = null;
      continue;
    }

    // Remove markdown bold/bullets for label detection
    const cleanLine = line.replace(/^[•\-\*\_\s]+/, "").replace(/[\*_]/g, "");

    // Check line against known field patterns
    const colonIndex = cleanLine.indexOf(":");
    let matchedKey: keyof OrderDraft | null = null;
    let valueAfterColon = "";

    if (colonIndex !== -1) {
      const labelCandidate = cleanLine.slice(0, colonIndex).toLowerCase().trim();
      valueAfterColon = cleanLine.slice(colonIndex + 1);

      if (labelCandidate.includes("nama pemesan") || labelCandidate === "nama") {
        matchedKey = "nama_pemesan";
      } else if (
        labelCandidate.includes("jenis pesanan") ||
        labelCandidate.includes("layanan")
      ) {
        matchedKey = "jenis_pesanan";
      } else if (
        labelCandidate.includes("tanggal acara") ||
        labelCandidate.includes("tanggal pengiriman") ||
        labelCandidate.includes("tanggal")
      ) {
        matchedKey = "tanggal_acara";
      } else if (
        labelCandidate.includes("jam pengiriman") ||
        labelCandidate.includes("jam acara") ||
        labelCandidate.includes("jam") ||
        labelCandidate.includes("waktu")
      ) {
        matchedKey = "jam_pengiriman";
      } else if (
        labelCandidate.includes("alamat") ||
        labelCandidate.includes("lokasi")
      ) {
        matchedKey = "alamat";
      } else if (
        labelCandidate.includes("request khusus") ||
        labelCandidate.includes("catatan khusus") ||
        labelCandidate.includes("request") ||
        labelCandidate.includes("catatan")
      ) {
        matchedKey = "request_khusus";
      }
    }

    if (matchedKey) {
      currentKey = matchedKey;
      const cleaned = cleanFieldValue(valueAfterColon);
      if (cleaned) {
        fields[matchedKey] = cleaned;
      }
    } else if (currentKey && !cleanLine.startsWith("*FORMAT")) {
      if (/salin dan isi/i.test(cleanLine)) {
        currentKey = null;
        continue;
      }
      // Continuation of previous multi-line field (e.g. address)
      const existing = fields[currentKey];
      const additional = cleanFieldValue(cleanLine);
      if (additional) {
        fields[currentKey] = existing ? `${existing} ${additional}` : additional;
      }
    }
  }

  if (fields.request_khusus) {
    fields.request_khusus = fields.request_khusus
      .replace(/_?Salin dan isi[\s\S]*/i, "")
      .trim();
    if (!fields.request_khusus) {
      fields.request_khusus = undefined;
    }
  }

  // Parse date if tanggal_acara is present
  if (fields.tanggal_acara) {
    const parsed = parseDateId(fields.tanggal_acara);
    fields.parsed_date = parsed;
  }

  const missing: RequiredField[] = [];
  if (!fields.nama_pemesan) missing.push("nama_pemesan");
  if (!fields.jenis_pesanan) missing.push("jenis_pesanan");
  if (!fields.tanggal_acara || !fields.parsed_date) missing.push("tanggal_acara");
  if (!fields.alamat) missing.push("alamat");

  return { fields, missing };
}
