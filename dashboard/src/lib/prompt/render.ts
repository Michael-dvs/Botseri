const TRIGGER_PATTERN =
  /<!--\s*TRIGGER:([A-Z_]+)\s*-->([\s\S]*?)<!--\s*\/TRIGGER:\1\s*-->/g;

export type RuntimeContext = {
  current_datetime: string;
  trigger_type: string;
  active_todos: unknown;
  untimed_recent_todos?: unknown;
  daily_stats: unknown;
  calendar_events_today: unknown;
  recent_messages: unknown;
};

export function selectTriggerBlock(
  compiledPrompt: string,
  trigger: string,
): string {
  let selected = "";
  const stripped = compiledPrompt.replace(
    TRIGGER_PATTERN,
    (_match, name: string, body: string) => {
      if (name === trigger) selected = body;
      return "";
    },
  );
  if (!selected) return stripped.trim();
  return `${stripped.trim()}\n\n${selected.trim()}`;
}

export function renderPrompt(
  compiledPrompt: string,
  trigger: string,
  context: RuntimeContext,
): string {
  const template = selectTriggerBlock(compiledPrompt, trigger);
  return template.replace(
    /\{\{\s*([a-z_]+)\s*\}\}/g,
    (match, name: string) => {
      if (!(name in context)) {
        throw new Error(`placeholder runtime tidak terisi: ${name}`);
      }
      const value = context[name as keyof RuntimeContext];
      if (value === undefined) {
        throw new Error(`placeholder runtime tidak terisi: ${name}`);
      }
      return typeof value === "string" ? value : JSON.stringify(value);
    },
  );
}
