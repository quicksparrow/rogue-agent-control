import { IntegrationError } from "./errors";
export type Fetcher = typeof fetch;

/** Deadline includes response body consumption; remote errors are never echoed or logged. */
export async function boundedJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetcher: Fetcher = fetch,
  parent?: AbortSignal,
): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  parent?.addEventListener("abort", abort, { once: true });
  if (parent?.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  let rejectAborted: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    rejectAborted = () =>
      reject(
        new IntegrationError(
          timedOut || !parent?.aborted ? "timeout" : "cancelled",
        ),
      );
    controller.signal.addEventListener("abort", rejectAborted, { once: true });
  });
  try {
    if (controller.signal.aborted) throw new IntegrationError("cancelled");
    const work = async () => {
      let response: Response;
      try {
        response = await fetcher(url, {
          ...init,
          redirect: "error",
          signal: controller.signal,
          cache: "no-store",
        });
      } catch {
        if (controller.signal.aborted)
          throw new IntegrationError(timedOut ? "timeout" : "cancelled");
        throw new IntegrationError("unavailable");
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new IntegrationError(
          response.status === 401 || response.status === 403
            ? "authentication_failed"
            : response.status === 429
              ? "rate_limited"
              : response.status === 402
                ? "credits_required"
                : response.status === 404
                  ? "model_unavailable"
                  : "service_error",
        );
      }
      if (Number(response.headers.get("content-length")) > 2 * 1024 * 1024) {
        await response.body?.cancel();
        throw new IntegrationError("service_error");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new IntegrationError("service_error");
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 2 * 1024 * 1024) {
            await reader.cancel();
            throw new IntegrationError("service_error");
          }
          chunks.push(value);
        }
        try {
          return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
        } catch {
          throw new IntegrationError("service_error");
        }
      } finally {
        reader.releaseLock();
      }
    };
    return await Promise.race([work(), aborted]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", rejectAborted);
  }
}
