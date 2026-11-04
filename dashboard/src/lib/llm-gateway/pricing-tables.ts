export interface CuratedModelMetadata {
  name: string;
  context_length: number;
  max_output_tokens: number;
  pricing: {
    input_per_mtok_usd: number;
    output_per_mtok_usd: number;
    is_free: boolean;
  };
  capabilities: {
    vision: boolean;
    audio_stt: boolean;
    function_calling: boolean;
    reasoning: boolean;
  };
  recommended_stt_model: string;
  description?: string;
}

export const OPENAI_CURATED_MODELS: Record<string, CuratedModelMetadata> = {
  "gpt-4o-mini": {
    name: "GPT-4o mini",
    context_length: 128_000,
    max_output_tokens: 16_384,
    pricing: {
      input_per_mtok_usd: 0.15,
      output_per_mtok_usd: 0.6,
      is_free: false,
    },
    capabilities: {
      vision: true,
      audio_stt: false,
      function_calling: true,
      reasoning: false,
    },
    recommended_stt_model: "whisper-1",
    description: "Model cepat dan sangat hemat biaya untuk sebagian besar tugas operasional dan obrolan.",
  },
  "gpt-4o": {
    name: "GPT-4o (Omni)",
    context_length: 128_000,
    max_output_tokens: 16_384,
    pricing: {
      input_per_mtok_usd: 2.5,
      output_per_mtok_usd: 10.0,
      is_free: false,
    },
    capabilities: {
      vision: true,
      audio_stt: false,
      function_calling: true,
      reasoning: false,
    },
    recommended_stt_model: "whisper-1",
    description: "Model flagship multimodal berkecepatan tinggi dengan kapabilitas analisis kompleks.",
  },
  "gpt-4o-2024-11-20": {
    name: "GPT-4o (2024-11-20)",
    context_length: 128_000,
    max_output_tokens: 16_384,
    pricing: {
      input_per_mtok_usd: 2.5,
      output_per_mtok_usd: 10.0,
      is_free: false,
    },
    capabilities: {
      vision: true,
      audio_stt: false,
      function_calling: true,
      reasoning: false,
    },
    recommended_stt_model: "whisper-1",
    description: "Snapshot terbaru GPT-4o dengan instruksi yang lebih patuh.",
  },
  "chatgpt-4o-latest": {
    name: "ChatGPT-4o Latest",
    context_length: 128_000,
    max_output_tokens: 16_384,
    pricing: {
      input_per_mtok_usd: 2.5,
      output_per_mtok_usd: 10.0,
      is_free: false,
    },
    capabilities: {
      vision: true,
      audio_stt: false,
      function_calling: true,
      reasoning: false,
    },
    recommended_stt_model: "whisper-1",
    description: "Versi dinamis yang selalu mengikuti model ChatGPT-4o terbaru.",
  },
  "o1": {
    name: "o1 Reasoning Flagship",
    context_length: 200_000,
    max_output_tokens: 100_000,
    pricing: {
      input_per_mtok_usd: 15.0,
      output_per_mtok_usd: 60.0,
      is_free: false,
    },
    capabilities: {
      vision: true,
      audio_stt: false,
      function_calling: true,
      reasoning: true,
    },
    recommended_stt_model: "whisper-1",
    description: "Model reasoning mendalam dengan chain-of-thought untuk logika rumit.",
  },
  "o1-mini": {
    name: "o1-mini Reasoning Cepat",
    context_length: 128_000,
    max_output_tokens: 65_536,
    pricing: {
      input_per_mtok_usd: 1.1,
      output_per_mtok_usd: 4.4,
      is_free: false,
    },
    capabilities: {
      vision: false,
      audio_stt: false,
      function_calling: true,
      reasoning: true,
    },
    recommended_stt_model: "whisper-1",
    description: "Model reasoning ekonomis dioptimalkan untuk logika dan coding.",
  },
  "o3-mini": {
    name: "o3-mini Reasoning Efisien",
    context_length: 200_000,
    max_output_tokens: 100_000,
    pricing: {
      input_per_mtok_usd: 1.1,
      output_per_mtok_usd: 4.4,
      is_free: false,
    },
    capabilities: {
      vision: false,
      audio_stt: false,
      function_calling: true,
      reasoning: true,
    },
    recommended_stt_model: "whisper-1",
    description: "Generasi baru model reasoning OpenAI berkecepatan tinggi.",
  },
  "gpt-4-turbo": {
    name: "GPT-4 Turbo",
    context_length: 128_000,
    max_output_tokens: 4_096,
    pricing: {
      input_per_mtok_usd: 10.0,
      output_per_mtok_usd: 30.0,
      is_free: false,
    },
    capabilities: {
      vision: true,
      audio_stt: false,
      function_calling: true,
      reasoning: false,
    },
    recommended_stt_model: "whisper-1",
  },
  "gpt-3.5-turbo": {
    name: "GPT-3.5 Turbo",
    context_length: 16_385,
    max_output_tokens: 4_096,
    pricing: {
      input_per_mtok_usd: 0.5,
      output_per_mtok_usd: 1.5,
      is_free: false,
    },
    capabilities: {
      vision: false,
      audio_stt: false,
      function_calling: true,
      reasoning: false,
    },
    recommended_stt_model: "whisper-1",
  },
};

export const GEMINI_CURATED_MODELS: Record<string, CuratedModelMetadata> = {
  "gemini-2.5-flash": {
    name: "Gemini 2.5 Flash",
    context_length: 1_048_576,
    max_output_tokens: 8_192,
    pricing: {
      input_per_mtok_usd: 0.075,
      output_per_mtok_usd: 0.3,
      is_free: false,
    },
    capabilities: {
      vision: true,
      audio_stt: true,
      function_calling: true,
      reasoning: false,
    },
    recommended_stt_model: "gemini-2.5-flash",
    description: "Model multimodal ultra cepat Google dengan context window 1 juta token dan audio native.",
  },
  "gemini-2.5-pro": {
    name: "Gemini 2.5 Pro",
    context_length: 2_097_152,
    max_output_tokens: 8_192,
    pricing: {
      input_per_mtok_usd: 1.25,
      output_per_mtok_usd: 5.0,
      is_free: false,
    },
    capabilities: {
      vision: true,
      audio_stt: true,
      function_calling: true,
      reasoning: true,
    },
    recommended_stt_model: "gemini-2.5-flash",
    description: "Model reasoning kelas atas Google dengan 2 juta token context window.",
  },
  "gemini-2.0-flash": {
    name: "Gemini 2.0 Flash",
    context_length: 1_048_576,
    max_output_tokens: 8_192,
    pricing: {
      input_per_mtok_usd: 0.1,
      output_per_mtok_usd: 0.4,
      is_free: false,
    },
    capabilities: {
      vision: true,
      audio_stt: true,
      function_calling: true,
      reasoning: false,
    },
    recommended_stt_model: "gemini-2.0-flash",
    description: "Model generasi 2.0 yang stabil, cepat, dan responsif untuk aplikasi agen.",
  },
  "gemini-2.0-flash-exp": {
    name: "Gemini 2.0 Flash (Experimental)",
    context_length: 1_048_576,
    max_output_tokens: 8_192,
    pricing: {
      input_per_mtok_usd: 0.0,
      output_per_mtok_usd: 0.0,
      is_free: true,
    },
    capabilities: {
      vision: true,
      audio_stt: true,
      function_calling: true,
      reasoning: false,
    },
    recommended_stt_model: "gemini-2.0-flash",
    description: "Versi eksperimental gratis dari Google AI Studio.",
  },
  "gemini-2.0-flash-thinking-exp": {
    name: "Gemini 2.0 Flash Thinking (Experimental)",
    context_length: 1_048_576,
    max_output_tokens: 65_536,
    pricing: {
      input_per_mtok_usd: 0.0,
      output_per_mtok_usd: 0.0,
      is_free: true,
    },
    capabilities: {
      vision: true,
      audio_stt: true,
      function_calling: true,
      reasoning: true,
    },
    recommended_stt_model: "gemini-2.0-flash",
    description: "Model reasoning eksperimental gratis dengan visualisasi pemikiran internal.",
  },
  "gemini-1.5-flash": {
    name: "Gemini 1.5 Flash",
    context_length: 1_048_576,
    max_output_tokens: 8_192,
    pricing: {
      input_per_mtok_usd: 0.075,
      output_per_mtok_usd: 0.3,
      is_free: false,
    },
    capabilities: {
      vision: true,
      audio_stt: true,
      function_calling: true,
      reasoning: false,
    },
    recommended_stt_model: "gemini-1.5-flash",
  },
  "gemini-1.5-flash-8b": {
    name: "Gemini 1.5 Flash 8B",
    context_length: 1_048_576,
    max_output_tokens: 8_192,
    pricing: {
      input_per_mtok_usd: 0.0375,
      output_per_mtok_usd: 0.15,
      is_free: false,
    },
    capabilities: {
      vision: true,
      audio_stt: true,
      function_calling: true,
      reasoning: false,
    },
    recommended_stt_model: "gemini-1.5-flash-8b",
  },
  "gemini-1.5-pro": {
    name: "Gemini 1.5 Pro",
    context_length: 2_097_152,
    max_output_tokens: 8_192,
    pricing: {
      input_per_mtok_usd: 1.25,
      output_per_mtok_usd: 5.0,
      is_free: false,
    },
    capabilities: {
      vision: true,
      audio_stt: true,
      function_calling: true,
      reasoning: false,
    },
    recommended_stt_model: "gemini-1.5-flash",
  },
};

export const ANTHROPIC_CURATED_MODELS: Record<string, CuratedModelMetadata> = {
  "claude-3-5-sonnet-latest": {
    name: "Claude 3.5 Sonnet (Latest)",
    context_length: 200_000,
    max_output_tokens: 8_192,
    pricing: {
      input_per_mtok_usd: 3.0,
      output_per_mtok_usd: 15.0,
      is_free: false,
    },
    capabilities: {
      vision: true,
      audio_stt: false,
      function_calling: true,
      reasoning: false,
    },
    recommended_stt_model: "whisper-1",
    description: "Model unggulan Anthropic dengan kecerdasan tinggi, penalaran bahasa murni, dan pemahaman kode.",
  },
  "claude-3-5-sonnet-20241022": {
    name: "Claude 3.5 Sonnet (2024-10-22)",
    context_length: 200_000,
    max_output_tokens: 8_192,
    pricing: {
      input_per_mtok_usd: 3.0,
      output_per_mtok_usd: 15.0,
      is_free: false,
    },
    capabilities: {
      vision: true,
      audio_stt: false,
      function_calling: true,
      reasoning: false,
    },
    recommended_stt_model: "whisper-1",
  },
  "claude-3-5-haiku-latest": {
    name: "Claude 3.5 Haiku (Latest)",
    context_length: 200_000,
    max_output_tokens: 8_192,
    pricing: {
      input_per_mtok_usd: 0.8,
      output_per_mtok_usd: 4.0,
      is_free: false,
    },
    capabilities: {
      vision: false,
      audio_stt: false,
      function_calling: true,
      reasoning: false,
    },
    recommended_stt_model: "whisper-1",
    description: "Model ringkas berkecepatan tinggi dengan responsivitas cepat dan biaya ekonomis.",
  },
  "claude-3-5-haiku-20241022": {
    name: "Claude 3.5 Haiku (2024-10-22)",
    context_length: 200_000,
    max_output_tokens: 8_192,
    pricing: {
      input_per_mtok_usd: 0.8,
      output_per_mtok_usd: 4.0,
      is_free: false,
    },
    capabilities: {
      vision: false,
      audio_stt: false,
      function_calling: true,
      reasoning: false,
    },
    recommended_stt_model: "whisper-1",
  },
  "claude-3-opus-latest": {
    name: "Claude 3 Opus (Latest)",
    context_length: 200_000,
    max_output_tokens: 4_096,
    pricing: {
      input_per_mtok_usd: 15.0,
      output_per_mtok_usd: 75.0,
      is_free: false,
    },
    capabilities: {
      vision: true,
      audio_stt: false,
      function_calling: true,
      reasoning: false,
    },
    recommended_stt_model: "whisper-1",
  },
  "claude-3-opus-20240229": {
    name: "Claude 3 Opus (2024-02-29)",
    context_length: 200_000,
    max_output_tokens: 4_096,
    pricing: {
      input_per_mtok_usd: 15.0,
      output_per_mtok_usd: 75.0,
      is_free: false,
    },
    capabilities: {
      vision: true,
      audio_stt: false,
      function_calling: true,
      reasoning: false,
    },
    recommended_stt_model: "whisper-1",
  },
  "claude-3-haiku-20240307": {
    name: "Claude 3 Haiku",
    context_length: 200_000,
    max_output_tokens: 4_096,
    pricing: {
      input_per_mtok_usd: 0.25,
      output_per_mtok_usd: 1.25,
      is_free: false,
    },
    capabilities: {
      vision: true,
      audio_stt: false,
      function_calling: true,
      reasoning: false,
    },
    recommended_stt_model: "whisper-1",
  },
};
