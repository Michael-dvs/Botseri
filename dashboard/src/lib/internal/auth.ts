import crypto from "node:crypto";

export function authorizeInternal(request: Request): boolean {
  const token = process.env.INTERNAL_API_TOKEN;
  if (!token) return false;
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  return (
    expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
  );
}

export function checkInternalAuth(request: Request): Response | null {
  if (!authorizeInternal(request)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}
