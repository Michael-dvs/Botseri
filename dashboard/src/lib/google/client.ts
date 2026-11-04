import { google } from "googleapis";
import { getValidAccessToken } from "./oauth";

export async function getGoogleClients() {
  const accessToken = await getValidAccessToken();
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return {
    calendar: google.calendar({ version: "v3", auth }),
    tasks: google.tasks({ version: "v1", auth }),
  };
}

export function googleErrorStatus(error: unknown): number | null {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "number") return code;
  if (typeof code === "string") {
    const parsed = Number(code);
    return Number.isNaN(parsed) ? null : parsed;
  }
  const status = (error as { response?: { status?: unknown } } | null)?.response
    ?.status;
  return typeof status === "number" ? status : null;
}
