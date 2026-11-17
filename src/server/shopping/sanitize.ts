/** A deliberately small projection, never a general secret detector. */
export function safeText(value: string, limit = 360): string {
  let text = value
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ");
  for (const key of [
    process.env.CHANNEL3_API_KEY,
    process.env.PAYPAL_CLIENT_ID,
    process.env.PAYPAL_CLIENT_SECRET,
  ]) {
    if (key) text = text.split(key).join("[REDACTED]");
  }
  text = text
    .replace(/\bBearer\s+\S+/gi, "[REDACTED]")
    .replace(/\b(?:sk[-_]|ch3[-_])[A-Za-z0-9_-]{8,}/gi, "[REDACTED]")
    .replace(
      /\b(?:api[_ -]?key|client[_ -]?secret|password|token)\s*[:=]\s*[^\s,;]+/gi,
      "[REDACTED]",
    )
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED]");
  return text.replace(/\s+/g, " ").trim().slice(0, limit);
}

export function safeSourceUrl(raw: string): string {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hostname === "localhost" ||
    /^(127\.|10\.|192\.168\.|169\.254\.|\[)/.test(url.hostname)
  )
    throw new Error("Unsupported source URL");
  url.search = "";
  url.hash = "";
  const result = url.toString();
  if (result.length > 600 || safeText(result, 600) !== result)
    throw new Error("Unsafe source reference");
  return result;
}
