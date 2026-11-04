type Level = "INFO" | "WARN" | "ERROR";

type LogEvent = {
  timestamp: string;
  level: Level;
  source: string;
  message?: string;
  context?: Record<string, unknown>;
  error?: { name: string; message: string; code?: string };
};

export function log(
  level: Level,
  source: string,
  message: string,
  context?: Record<string, unknown>,
  error?: unknown,
) {
  const event: LogEvent = {
    timestamp: new Date().toISOString(),
    level,
    source,
    message,
    context,
  };
  if (error instanceof Error) {
    const code = "code" in error && typeof error.code === "string"
      ? error.code
      : undefined;
    event.error = { name: error.name, message: error.message, code };
  } else if (error !== undefined) {
    event.error = { name: "Error", message: String(error) };
  }
  process.stdout.write(`${JSON.stringify(event)}\n`);
}
