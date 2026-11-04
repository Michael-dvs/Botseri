import type { LlmConfig } from "@prisma/client";

export type ProviderErrorKind =
  | "RATE_LIMIT"
  | "AUTH"
  | "TIMEOUT"
  | "BAD_REQUEST"
  | "UPSTREAM"
  | "TRUNCATED";

export interface ProviderErrorDetail {
  kind: ProviderErrorKind;
  status: number;
  provider: string;
  model: string;
  message: string;
}

export class NoActiveLlmError extends Error {
  constructor() {
    super("No active LLM configuration available");
    this.name = "NoActiveLlmError";
  }
}

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;

  constructor(
    message: string,
    readonly status: number,
    readonly config: LlmConfig,
    readonly provider: string,
    readonly latencyMs: number,
    kind?: ProviderErrorKind,
  ) {
    super(message);
    this.name = "ProviderError";

    if (kind) {
      this.kind = kind;
    } else if (status === 429) {
      this.kind = "RATE_LIMIT";
    } else if (status === 401 || status === 403) {
      this.kind = "AUTH";
    } else if (status === 504 || status === 408) {
      this.kind = "TIMEOUT";
    } else if (status === 400 || status === 422) {
      this.kind = "BAD_REQUEST";
    } else {
      this.kind = "UPSTREAM";
    }
  }

  toJSON() {
    return {
      error: {
        code: this.kind,
        message: this.message,
        provider: this.provider,
        model: this.config?.model,
      },
    };
  }
}

export class OutputTruncatedError extends Error {
  readonly kind: ProviderErrorKind = "TRUNCATED";
  readonly status = 422;

  constructor(
    readonly model: string,
    readonly tokenLimit?: number,
  ) {
    super(
      "Jawaban terpotong karena batas panjang teks. Silakan coba ulangi permintaan secara lebih spesifik atau sesuaikan batas token di dashboard."
    );
    this.name = "OutputTruncatedError";
  }

  toJSON() {
    return {
      error: {
        code: this.kind,
        message: this.message,
        model: this.model,
      },
    };
  }
}
