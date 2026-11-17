import { z } from "zod";
import { boundedJson, type Fetcher } from "./network";
import { IntegrationError } from "./errors";

export interface ModelHealth {
  available: true;
  model: "qwen3:4b";
  think: boolean;
  context_length: number;
}
export interface Generation<T> {
  value: T;
  prompt_tokens: number;
  output_tokens: number;
  think: boolean;
}
export interface ShoppingModel {
  health(signal?: AbortSignal): Promise<ModelHealth>;
  generate<T>(
    schema: z.ZodType<T>,
    system: string,
    data: unknown,
    health: ModelHealth,
    signal?: AbortSignal,
  ): Promise<Generation<T>>;
}
function configInt(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max)
    throw new IntegrationError("configuration");
  return parsed;
}
export class OllamaModel implements ShoppingModel {
  readonly contextLength: number;
  readonly outputTokens: number;
  readonly timeoutMs: number;
  private base: string;
  constructor(
    private options: {
      baseUrl?: string;
      contextLength?: number;
      outputTokens?: number;
      timeoutMs?: number;
      think?: boolean;
      fetcher?: Fetcher;
    } = {},
  ) {
    this.base =
      options.baseUrl ??
      process.env.OLLAMA_BASE_URL ??
      "http://127.0.0.1:11434";
    if (process.env.LLM_PROVIDER && process.env.LLM_PROVIDER !== "ollama")
      throw new IntegrationError("configuration");
    let url: URL;
    try {
      url = new URL(this.base);
    } catch {
      throw new IntegrationError("configuration");
    }
    if (
      url.protocol !== "http:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      (process.env.OLLAMA_MODEL && process.env.OLLAMA_MODEL !== "qwen3:4b")
    )
      throw new IntegrationError("configuration");
    this.base = url.origin;
    this.contextLength = configInt(
      String(
        options.contextLength ?? process.env.OLLAMA_CONTEXT_LENGTH ?? 4096,
      ),
      4096,
      2048,
      32768,
    );
    this.outputTokens = configInt(
      String(options.outputTokens ?? process.env.OLLAMA_OUTPUT_TOKENS ?? 1536),
      1536,
      256,
      4096,
    );
    this.timeoutMs = configInt(
      String(options.timeoutMs ?? process.env.OLLAMA_TIMEOUT_MS ?? 90000),
      90000,
      5,
      120000,
    );
    if (this.outputTokens + 512 >= this.contextLength)
      throw new IntegrationError("configuration");
  }
  async health(signal?: AbortSignal): Promise<ModelHealth> {
    const tags = await boundedJson(
      `${this.base}/api/tags`,
      {},
      Math.min(5000, this.timeoutMs),
      this.options.fetcher,
      signal,
    );
    const models = z
      .object({ models: z.array(z.object({ name: z.string() })) })
      .safeParse(tags);
    if (
      !models.success ||
      !models.data.models.some((m) => m.name === "qwen3:4b")
    )
      throw new IntegrationError("model_unavailable");
    const raw = await boundedJson(
      `${this.base}/api/show`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "qwen3:4b" }),
      },
      Math.min(5000, this.timeoutMs),
      this.options.fetcher,
      signal,
    );
    const info = z
      .object({
        capabilities: z.array(z.string()),
        thinking: z
          .object({ values: z.array(z.union([z.boolean(), z.string()])) })
          .optional(),
      })
      .safeParse(raw);
    if (!info.success || !info.data.capabilities.includes("completion"))
      throw new IntegrationError("model_unavailable");
    const configured = process.env.OLLAMA_THINK ?? "false";
    if (!["true", "false"].includes(configured))
      throw new IntegrationError("configuration");
    const think = this.options.think ?? configured === "true";
    if (think && !info.data.capabilities.includes("thinking"))
      throw new IntegrationError("configuration");
    // This exact qwen3:4b installation accepts think:false even though /api/show
    // advertises [true]. Verified with a real request; no automatic mode fallback.
    return {
      available: true,
      model: "qwen3:4b",
      think,
      context_length: this.contextLength,
    };
  }
  async generate<T>(
    schema: z.ZodType<T>,
    system: string,
    data: unknown,
    health: ModelHealth,
    signal?: AbortSignal,
  ): Promise<Generation<T>> {
    const format = z.toJSONSchema(schema);
    const messages = [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(data) },
    ];
    // UTF-8 bytes give a conservative text-token bound, with 256 tokens for chat framing.
    // format is a decoder grammar, not a chat message; actual prompt token usage is checked below too.
    if (
      Buffer.byteLength(JSON.stringify(messages), "utf8") +
        this.outputTokens +
        256 >
      this.contextLength
    )
      throw new IntegrationError("context_limit");
    const raw = await boundedJson(
      `${this.base}/api/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "qwen3:4b",
          messages,
          format,
          stream: false,
          think: health.think,
          options: {
            num_ctx: this.contextLength,
            num_predict: this.outputTokens,
            temperature: 0.6,
          },
          keep_alive: "5m",
        }),
      },
      this.timeoutMs,
      this.options.fetcher,
      signal,
    );
    const response = z
      .object({
        model: z.string(),
        done: z.literal(true),
        done_reason: z.literal("stop"),
        message: z.object({
          role: z.literal("assistant"),
          content: z.string().min(1).max(12000),
        }),
        prompt_eval_count: z.number().int().nonnegative(),
        eval_count: z.number().int().nonnegative(),
      })
      .safeParse(raw);
    if (!response.success || response.data.model !== "qwen3:4b")
      throw new IntegrationError("invalid_model_output");
    if (
      response.data.prompt_eval_count + this.outputTokens >
      this.contextLength
    )
      throw new IntegrationError("context_limit");
    // The unknown raw response and message.thinking never escape this adapter.
    try {
      const value = schema.parse(JSON.parse(response.data.message.content));
      return {
        value,
        prompt_tokens: response.data.prompt_eval_count,
        output_tokens: response.data.eval_count,
        think: health.think,
      };
    } catch {
      throw new IntegrationError("invalid_model_output");
    }
  }
}
