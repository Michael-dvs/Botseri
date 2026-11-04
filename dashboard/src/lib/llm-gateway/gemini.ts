import { setTimeout as delay } from "node:timers/promises";
import type { ChatConfig, ChatPayload } from "./openai-compatible";

export type GeminiPart =
  | { text: string }
  | {
      functionCall: {
        name: string;
        args: Record<string, unknown>;
      };
    }
  | {
      functionResponse: {
        name: string;
        response: Record<string, unknown>;
      };
    };

export type GeminiContent = {
  role: "user" | "model";
  parts: GeminiPart[];
};

export type GeminiToolDeclaration = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type GeminiTool = {
  functionDeclarations: GeminiToolDeclaration[];
};

export type GeminiPayload = {
  contents: GeminiContent[];
  systemInstruction?: {
    parts: Array<{ text: string }>;
  };
  tools?: GeminiTool[];
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
  };
};

const ALLOWED_GEMINI_SCHEMA_KEYS: Record<string, true> = {
  type: true,
  description: true,
  enum: true,
  properties: true,
  required: true,
  items: true,
  nullable: true,
  minimum: true,
  maximum: true,
  minItems: true,
  maxItems: true,
  format: true,
};

export function cleanGeminiSchema(schema: unknown, rootDefs?: Record<string, unknown>): Record<string, unknown> {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return { type: "object", properties: {} };
  }

  const rawObj = schema as Record<string, unknown>;
  const defs =
    rootDefs ||
    ((rawObj.$defs || rawObj.definitions) as Record<string, unknown> | undefined);

  // Selesaikan $ref jika ada
  if (typeof rawObj.$ref === "string") {
    const refPath = rawObj.$ref;
    const refKey = refPath.replace(/^#\/(\$defs|definitions)\//, "");
    if (defs && defs[refKey] && typeof defs[refKey] === "object") {
      return cleanGeminiSchema(defs[refKey], defs);
    }
  }

  const cleaned: Record<string, unknown> = {};

  // Transformasi anyOf: [{ type: X }, { type: "null" }]
  if (Array.isArray(rawObj.anyOf)) {
    const nonNull = rawObj.anyOf.find((item) => {
      if (item && typeof item === "object") {
        return (item as Record<string, unknown>).type !== "null";
      }
      return false;
    }) as Record<string, unknown> | undefined;

    if (nonNull) {
      const cleanedNonNull = cleanGeminiSchema(nonNull, defs);
      Object.assign(cleaned, cleanedNonNull);
      cleaned.nullable = true;
    }
  }

  // Transformasi type: [X, "null"]
  if (Array.isArray(rawObj.type)) {
    const nonNullType = rawObj.type.find((t) => t !== "null");
    cleaned.type = typeof nonNullType === "string" ? nonNullType : "string";
    cleaned.nullable = true;
  } else if (typeof rawObj.type === "string") {
    cleaned.type = rawObj.type;
  } else if (!cleaned.type) {
    cleaned.type = "object";
  }

  for (const [key, value] of Object.entries(rawObj)) {
    // Whitelist attribute check
    if (!ALLOWED_GEMINI_SCHEMA_KEYS[key]) continue;
    if (key === "type") continue;

    if (key === "format") {
      // Gemini hanya mengizinkan format untuk enum atau date-time
      if (value === "date-time" || Array.isArray(rawObj.enum)) {
        cleaned.format = value;
      }
      continue;
    }

    if (key === "properties" && value && typeof value === "object" && !Array.isArray(value)) {
      const propObj: Record<string, unknown> = {};
      for (const [propKey, propVal] of Object.entries(value as Record<string, unknown>)) {
        if (propVal && typeof propVal === "object" && !Array.isArray(propVal)) {
          propObj[propKey] = cleanGeminiSchema(propVal, defs);
        } else {
          propObj[propKey] = propVal;
        }
      }
      cleaned.properties = propObj;
      continue;
    }

    if (key === "items" && value && typeof value === "object") {
      cleaned.items = cleanGeminiSchema(value, defs);
      continue;
    }

    cleaned[key] = value;
  }

  return cleaned;
}
function convertToolsToGemini(rawTools: unknown): GeminiTool[] | undefined {
  if (!Array.isArray(rawTools) || rawTools.length === 0) return undefined;

  const declarations: GeminiToolDeclaration[] = [];
  for (const item of rawTools) {
    if (item && typeof item === "object" && "function" in item) {
      const fn = (item as { function: Record<string, unknown> }).function;
      if (fn && typeof fn === "object" && typeof fn.name === "string") {
        declarations.push({
          name: fn.name,
          description: typeof fn.description === "string" ? fn.description : "",
          parameters: cleanGeminiSchema(
            fn.parameters || { type: "object", properties: {} },
          ),
        });
      }
    }
  }

  if (declarations.length === 0) return undefined;
  return [{ functionDeclarations: declarations }];
}

export function toGeminiPayload(
  payload: ChatPayload,
  config: ChatConfig,
): GeminiPayload {
  const systemTexts: string[] = [];
  const contents: GeminiContent[] = [];

  const rawMessages = Array.isArray(payload.messages) ? payload.messages : [];

  for (const msg of rawMessages) {
    if (!msg || typeof msg !== "object") continue;
    const item = msg as Record<string, unknown>;
    const role = String(item.role ?? "user").toLowerCase();

    // 1. Ekstraksi systemInstruction
    if (role === "system") {
      const contentStr = typeof item.content === "string" ? item.content.trim() : "";
      if (contentStr) {
        systemTexts.push(contentStr);
      }
      continue;
    }

    // 2. role: "user"
    if (role === "user") {
      const text = typeof item.content === "string" ? item.content : String(item.content ?? "");
      contents.push({
        role: "user",
        parts: [{ text }],
      });
      continue;
    }

    // 3. role: "assistant"
    if (role === "assistant" || role === "model") {
      const parts: GeminiPart[] = [];
      if (typeof item.content === "string" && item.content.trim()) {
        parts.push({ text: item.content });
      }

      if (Array.isArray(item.tool_calls) && item.tool_calls.length > 0) {
        for (const tc of item.tool_calls) {
          if (tc && typeof tc === "object" && "function" in tc) {
            const fn = (tc as { function: Record<string, unknown> }).function;
            if (fn && typeof fn === "object" && typeof fn.name === "string") {
              let parsedArgs: Record<string, unknown> = {};
              if (typeof fn.arguments === "string") {
                try {
                  parsedArgs = JSON.parse(fn.arguments);
                } catch {
                  parsedArgs = {};
                }
              } else if (fn.arguments && typeof fn.arguments === "object") {
                parsedArgs = fn.arguments as Record<string, unknown>;
              }

              parts.push({
                functionCall: {
                  name: fn.name,
                  args: parsedArgs,
                },
              });
            }
          }
        }
      }

      if (parts.length > 0) {
        contents.push({
          role: "model",
          parts,
        });
      }
      continue;
    }

    // 4. role: "tool"
    if (role === "tool") {
      let respObj: Record<string, unknown>;
      const rawContent = typeof item.content === "string" ? item.content : "";
      try {
        const parsed = JSON.parse(rawContent);
        respObj = typeof parsed === "object" && parsed !== null ? parsed : { result: parsed };
      } catch {
        respObj = { output: rawContent };
      }

      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: typeof item.name === "string" ? item.name : "tool_result",
              response: respObj,
            },
          },
        ],
      });
      continue;
    }
  }

  // Fallback jika contents kosong
  if (contents.length === 0) {
    contents.push({
      role: "user",
      parts: [{ text: "Halo" }],
    });
  }

  const isThinkingModel =
    config.model.includes("2.5") ||
    config.model.toLowerCase().includes("thinking");
  const rawMaxTokens = payload.max_tokens ?? config.max_output_tokens ?? 2048;
  const safeMaxOutputTokens = isThinkingModel ? Math.max(rawMaxTokens, 4096) : rawMaxTokens;

  const geminiPayload: GeminiPayload = {
    contents,
    generationConfig: {
      temperature: payload.temperature ?? config.temperature ?? 0.2,
      maxOutputTokens: safeMaxOutputTokens,
    },
  };

  if (systemTexts.length > 0) {
    geminiPayload.systemInstruction = {
      parts: [{ text: systemTexts.join("\n\n") }],
    };
  }

  const convertedTools = convertToolsToGemini(payload.tools);
  if (convertedTools) {
    geminiPayload.tools = convertedTools;
  }

  return geminiPayload;
}

export async function callGemini(
  config: ChatConfig,
  apiKey: string,
  payload: ChatPayload,
  signal?: AbortSignal,
): Promise<Response> {
  const cleanKey = apiKey.trim();
  const cleanModel = config.model.replace(/^models\//, "");
  const base = config.base_url
    ? config.base_url.replace(/\/+$/, "")
    : "https://generativelanguage.googleapis.com/v1beta";

  const url = `${base}/models/${cleanModel}:generateContent`;
  const geminiBody = toGeminiPayload(payload, config);

  for (let attempt = 0; ; attempt += 1) {
    const timeoutSignal = AbortSignal.timeout(45_000);
    const effectiveSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": cleanKey,
      },
      body: JSON.stringify(geminiBody),
      signal: effectiveSignal,
    });

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt > 0) return response;

    await response.body?.cancel();
    await delay(1000);
  }
}

type GeminiCandidate = {
  content?: {
    parts?: Array<{
      text?: string;
      functionCall?: {
        name: string;
        args?: Record<string, unknown>;
      };
    }>;
    role?: string;
  };
  finishReason?: string;
  index?: number;
};

type GeminiRawResponse = {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: {
    code: number;
    message: string;
    status: string;
  };
};

export function geminiToOpenAi(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") {
    return {
      id: "chatcmpl-" + Math.random().toString(36).substring(2, 10),
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      choices: [],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
  }

  const res = raw as GeminiRawResponse;
  const candidate = Array.isArray(res.candidates) ? res.candidates[0] : undefined;
  const parts = candidate?.content?.parts ?? [];

  const toolCalls: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }> = [];

  const textParts: string[] = [];

  for (const part of parts) {
    if (part.functionCall && typeof part.functionCall.name === "string") {
      toolCalls.push({
        id: "call_" + Math.random().toString(36).substring(2, 9),
        type: "function",
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args ?? {}),
        },
      });
    } else if (typeof part.text === "string") {
      textParts.push(part.text);
    }
  }

  const rawFinish = candidate?.finishReason?.toUpperCase() ?? "STOP";
  let finishReason = "stop";
  if (toolCalls.length > 0) {
    finishReason = "tool_calls";
  } else if (rawFinish === "MAX_TOKENS") {
    finishReason = "length";
  } else if (rawFinish === "STOP") {
    finishReason = "stop";
  }

  const messageObj: Record<string, unknown> = {
    role: "assistant",
  };

  if (toolCalls.length > 0) {
    messageObj.content = null;
    messageObj.tool_calls = toolCalls;
  } else {
    messageObj.content = textParts.join("\n").trim();
  }

  return {
    id: "chatcmpl-" + Math.random().toString(36).substring(2, 10),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    choices: [
      {
        index: 0,
        message: messageObj,
        finish_reason: finishReason,
      },
    ],
    usage: {
      prompt_tokens: res.usageMetadata?.promptTokenCount ?? 0,
      completion_tokens: res.usageMetadata?.candidatesTokenCount ?? 0,
      total_tokens: res.usageMetadata?.totalTokenCount ?? 0,
    },
  };
}
