import { ZodError } from "zod";
import { StoreError } from "./store";
import { IntegrationError } from "./shopping/errors";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function localOnly(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host))
    throw new HttpError(403, "Local access only");
  const origin = request.headers.get("origin");
  if (
    (origin && origin !== `http://${host}`) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new HttpError(403, "Cross-origin access is not allowed");
}

export async function readJson(request: Request): Promise<unknown> {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new HttpError(415, "Use application/json");
  const max = 256 * 1024;
  if (Number(request.headers.get("content-length")) > max)
    throw new HttpError(413, "Request too large");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "JSON body required");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > max) {
        await reader.cancel();
        throw new HttpError(413, "Request too large");
      }
      chunks.push(value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new HttpError(400, "Invalid JSON");
    }
  } finally {
    reader.releaseLock();
  }
}

export function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function apiError(error: unknown): Response {
  if (error instanceof IntegrationError)
    return json({ error: error.message, error_code: error.code }, 503);
  if (error instanceof HttpError || error instanceof StoreError)
    return json({ error: error.message }, error.status);
  if (error instanceof ZodError)
    return json(
      {
        error:
          "Invalid event or request schema. Check required fields, permitted values, and schema_version.",
      },
      400,
    );
  if (
    error instanceof Error &&
    error.message === "An event cannot parent itself"
  )
    return json({ error: error.message }, 400);
  // Never log request bodies or database errors containing evidence or paths.
  return json(
    {
      error:
        "Black Box storage unavailable. Check local filesystem permissions and server status.",
    },
    503,
  );
}
