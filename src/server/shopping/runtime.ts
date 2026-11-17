import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  identifier,
  type Run,
  type RuntimeSource,
  type StoredEvent,
  type PolicySnapshot,
} from "../../lib/contracts";
import {
  estimateTotal,
  recommendationDecisionSchema,
  shoppingInputSchema,
  toolDecisionSchema,
  type LocalIdentity,
  type Mandate,
  type Product,
  type Recommendation,
  type ShoppingInput,
} from "../../lib/shopping-contracts";
import { BlackBoxStore, StoreError } from "../store";
import { Channel3Catalog, OfflineCatalog, type Catalog } from "./catalog";
import { IntegrationError, safeFailure } from "./errors";
import { OllamaModel, type ShoppingModel } from "./ollama";
import { safeText } from "./sanitize";
import { searchSystem, recommendationSystem } from "./prompts";
import { localIdentity } from "../identity";
import type { OwnerPolicy } from "../../lib/firewall-contracts";
import { recordProposal, authorizeProposal } from "../firewall/gateway";
export { localIdentity } from "../identity";

export class Recorder {
  private parent: string | null;
  constructor(
    private store: BlackBoxStore,
    readonly runId: string,
  ) {
    this.parent = store.lastEventId(runId);
  }
  emit(
    type: StoredEvent["event_type"],
    payload: Record<string, unknown>,
    source: RuntimeSource = "application",
    actor: StoredEvent["actor"] = "collector",
    tool:
      | "catalog.search"
      | "catalog.get_product"
      | "ollama.chat"
      | null = null,
  ) {
    const id = `evt_${randomUUID()}`;
    this.parent = this.store.lastEventId(this.runId);
    this.store.appendRuntime(
      this.runId,
      [
        {
          schema_version: 2,
          event_id: id,
          parent_event_id: this.parent,
          timestamp: new Date().toISOString(),
          actor,
          event_type: type,
          tool,
          payload,
        },
      ],
      source,
    );
    this.parent = id;
    return id;
  }
}

export function createShoppingRun(
  store: BlackBoxStore,
  raw: unknown,
  controls?: { policy: OwnerPolicy; fixture?: boolean },
): Run {
  const input = shoppingInputSchema.parse(raw);
  if (input.merchant_ids.some((id) => safeText(id, 96) !== id))
    throw new StoreError(
      400,
      "Merchant identifiers contain sensitive or unsupported content",
    );
  const objective = safeText(input.objective);
  const preferences = input.preferences.map((p) => safeText(p, 80));
  const safe: ShoppingInput = shoppingInputSchema.parse({
    ...input,
    objective,
    preferences,
  });
  const mandate: Mandate = {
    ...safe,
    mandate_id: `mandate_${randomUUID()}`,
    identity: {
      ...localIdentity(),
      ...(controls
        ? { authorized_context: "policy_controlled_proposals" as const }
        : {}),
    },
    created_at: new Date().toISOString(),
    omitted_sensitive_fields:
      Number(objective !== input.objective) +
      preferences.filter((p, i) => p !== input.preferences[i]).length,
    ...(controls
      ? {
          firewall: {
            owner_policy_version: controls.policy.version,
            registry_version: controls.policy.registry_version,
          },
        }
      : {}),
  };
  const policy: PolicySnapshot = {
    version: `v1_${randomUUID()}`,
    owner_id: mandate.identity.owner_id,
    max_total_minor: safe.budget_minor,
    currency: safe.currency,
    merchant_ids: safe.merchant_ids,
    max_quantity: safe.quantity,
    approval_required: controls
      ? controls.policy.require_human_approval
      : safe.persona === "business",
    ...(controls
      ? {
          firewall: {
            owner_policy_version: controls.policy.version,
            registry_version: controls.policy.registry_version,
          },
        }
      : {}),
  };
  return store.db
    .transaction(() => {
      if (
        controls &&
        (controls.policy.owner_id !== mandate.identity.owner_id ||
          controls.policy.persona !== mandate.persona)
      )
        throw new StoreError(
          403,
          "Owner policy does not belong to this mandate owner/persona",
        );
      const run = store.createShopping(
        mandate,
        policy,
        Boolean(controls?.fixture),
      );
      const recorder = new Recorder(store, run.run_id);
      recorder.emit("run_created", {
        catalog_mode: safe.catalog_mode,
        mandate_id: mandate.mandate_id,
        agent_id: mandate.identity.agent_id,
        owner_id: mandate.identity.owner_id,
        authorized_context: mandate.identity.authorized_context,
      });
      recorder.emit(
        "mandate_captured",
        {
          mandate_id: mandate.mandate_id,
          owner_id: mandate.identity.owner_id,
          agent_id: mandate.identity.agent_id,
          max_total_minor: safe.budget_minor,
          currency: safe.currency,
          quantity: safe.quantity,
          objective_digest: createHash("sha256")
            .update(objective)
            .digest("hex"),
          preferences_count: preferences.length,
          omitted_sensitive_fields: mandate.omitted_sensitive_fields,
        },
        "application",
        "human",
      );
      return store.getRun(run.run_id);
    })
    .immediate();
}

function recommendation(
  product: Product,
  quantity: number,
  reasons: Recommendation["reason_codes"],
  mandate: Mandate,
): Recommendation {
  const total = estimateTotal(product.unit_amount_minor, quantity);
  const discrepancies: string[] = [];
  if (product.currency !== mandate.currency)
    discrepancies.push("currency_mismatch");
  else if (total > mandate.budget_minor) discrepancies.push("above_budget");
  if (!mandate.merchant_ids.includes(product.merchant_id))
    discrepancies.push("merchant_outside_mandate");
  if (quantity !== mandate.quantity) discrepancies.push("quantity_differs");
  if (product.availability !== "in_stock")
    discrepancies.push("availability_not_confirmed");
  return {
    product,
    quantity,
    total_amount_minor: total,
    reason_codes: reasons,
    discrepancies,
    estimate_only: true,
  };
}

/** Two model decisions; only registered read-only catalog operations can execute. */
export async function executeShoppingRun(
  store: BlackBoxStore,
  runId: string,
  dependencies: {
    model?: ShoppingModel;
    catalog?: Catalog;
    maxSteps?: number;
    durationMs?: number;
  } = {},
) {
  store.claimShopping(runId); // SQLite compare-and-swap prevents retry/concurrent duplicate execution.
  const saved = store.getShopping(runId);
  const mandate = saved.mandate;
  const recorder = new Recorder(store, runId);
  const durationMs =
    dependencies.durationMs ??
    Number(process.env.SHOPPING_TIMEOUT_MS ?? 240000);
  const maxSteps =
    dependencies.maxSteps ?? Number(process.env.SHOPPING_MAX_STEPS ?? 5);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Number.isInteger(durationMs) && durationMs > 0 ? durationMs : 1,
  );
  let modelCalls = 0,
    toolCalls = 0,
    steps = 0;
  const step = () => {
    if (controller.signal.aborted) throw new IntegrationError("timeout");
    if (++steps > maxSteps) throw new IntegrationError("execution_limit");
  };
  try {
    if (
      !Number.isInteger(maxSteps) ||
      maxSteps < 1 ||
      maxSteps > 5 ||
      !Number.isInteger(durationMs) ||
      durationMs < 1 ||
      durationMs > 300000
    )
      throw new IntegrationError("configuration");
    const model = dependencies.model ?? new OllamaModel();
    const catalog =
      dependencies.catalog ??
      (mandate.catalog_mode === "offline"
        ? new OfflineCatalog()
        : new Channel3Catalog());
    if (catalog.mode !== mandate.catalog_mode)
      throw new IntegrationError("configuration");
    const health = await model.health(controller.signal);
    const invoke = async <T>(
      schema: z.ZodType<T>,
      phase: "search" | "recommend",
      system: string,
      data: unknown,
    ) => {
      step();
      modelCalls++;
      const invocation = `inv_${randomUUID()}`;
      recorder.emit(
        "model_invoked",
        {
          invocation_id: invocation,
          step: phase,
          model: "qwen3:4b",
          context_length: health.context_length,
          think: health.think,
        },
        "application",
        "shopping_agent",
        "ollama.chat",
      );
      try {
        const result = await model.generate(
          schema,
          system,
          data,
          health,
          controller.signal,
        );
        if (controller.signal.aborted) throw new IntegrationError("timeout");
        recorder.emit(
          "model_completed",
          {
            invocation_id: invocation,
            step: phase,
            outcome: "completed",
            prompt_tokens: result.prompt_tokens,
            output_tokens: result.output_tokens,
          },
          "ollama",
          "shopping_agent",
          "ollama.chat",
        );
        return result.value;
      } catch (error) {
        recorder.emit(
          "model_completed",
          { invocation_id: invocation, step: phase, outcome: "failed" },
          "ollama",
          "shopping_agent",
          "ollama.chat",
        );
        throw error instanceof z.ZodError
          ? new IntegrationError("invalid_model_output")
          : error;
      }
    };
    const task = {
      objective: mandate.objective,
      preferences: mandate.preferences,
      budget_minor: mandate.budget_minor,
      currency: mandate.currency,
      quantity: mandate.quantity,
      merchant_ids: mandate.merchant_ids,
    };
    const proposed = await invoke(
      toolDecisionSchema,
      "search",
      searchSystem,
      task,
    );
    const requestId = `req_${randomUUID()}`;
    recorder.emit(
      "tool_proposed",
      { operation: "catalog.search", request_id: requestId },
      "ollama",
      "shopping_agent",
      "catalog.search",
    );
    const valid = toolDecisionSchema.safeParse(proposed);
    if (
      !valid.success ||
      safeText(valid.data.arguments.query, 100) !== valid.data.arguments.query
    )
      throw new IntegrationError("invalid_tool_arguments");
    recorder.emit(
      "tool_validated",
      {
        operation: "catalog.search",
        request_id: requestId,
        ...valid.data.arguments,
      },
      "application",
      "collector",
      "catalog.search",
    );
    const readCatalog = async (
      operation: "catalog.search" | "catalog.get_product",
      id: string,
      perform: () => Promise<Product[]>,
    ) => {
      step();
      toolCalls++;
      recorder.emit(
        "catalog_requested",
        { operation, request_id: id, catalog_mode: catalog.mode },
        "application",
        "catalog",
        operation,
      );
      try {
        const products = await perform();
        if (controller.signal.aborted) throw new IntegrationError("timeout");
        const source = catalog.mode === "offline" ? "seed_catalog" : "channel3";
        recorder.emit(
          "catalog_received",
          {
            operation,
            request_id: id,
            catalog_mode: catalog.mode,
            result_count: products.length,
            products: products.map((p) => ({
              product_id: p.product_id,
              source_product_id: p.source_product_id,
              merchant_id: p.merchant_id,
              unit_amount_minor: p.unit_amount_minor,
              currency: p.currency,
              availability: p.availability,
            })),
            content_trust: "untrusted",
            descriptions_omitted: true,
          },
          source,
          "catalog",
          operation,
        );
        return products;
      } catch (error) {
        const failure = safeFailure(error);
        const catalogCode = [
          "unavailable",
          "timeout",
          "cancelled",
          "not_configured",
          "authentication_failed",
          "rate_limited",
          "credits_required",
          "service_error",
          "malformed_catalog",
          "ungrounded_product",
        ].includes(failure.code)
          ? failure.code
          : "service_error";
        recorder.emit(
          "catalog_failed",
          { request_id: id, error_code: catalogCode },
          catalog.mode === "offline" ? "seed_catalog" : "channel3",
          "catalog",
          operation,
        );
        throw failure;
      }
    };
    const products = await readCatalog("catalog.search", requestId, () =>
      catalog.search(valid.data.arguments, mandate.currency, controller.signal),
    );
    store.saveShoppingProducts(runId, products);
    if (!products.length) throw new IntegrationError("empty_catalog");
    const observedIds = products.map((p) => p.product_id) as [
      string,
      ...string[],
    ];
    const groundedDecisionSchema = recommendationDecisionSchema.extend({
      recommendations: z
        .array(
          recommendationDecisionSchema.shape.recommendations.element.extend({
            product_id: z.enum(observedIds),
          }),
        )
        .max(2),
    });
    const decision = await invoke(
      groundedDecisionSchema,
      "recommend",
      recommendationSystem,
      {
        task,
        UNTRUSTED_CATALOG_DATA: products.map((p) => ({
          product_id: p.product_id,
          title: p.title.slice(0, 80),
          unit_minor: p.unit_amount_minor,
          currency: p.currency,
          availability: p.availability,
          merchant: p.merchant_id,
        })),
      },
    );
    const parsed = recommendationDecisionSchema.safeParse(decision);
    if (
      !parsed.success ||
      (parsed.data.status === "no_match") !==
        (parsed.data.recommendations.length === 0)
    )
      throw new IntegrationError("invalid_model_output");
    if (
      new Set(parsed.data.recommendations.map((r) => r.product_id)).size !==
      parsed.data.recommendations.length
    )
      throw new IntegrationError("invalid_model_output");
    // Validate the whole recommendation set against this run's evidence before accepting any.
    if (
      parsed.data.recommendations.some(
        (r) => !products.some((p) => p.product_id === r.product_id),
      )
    )
      throw new IntegrationError("ungrounded_product");
    const recommendations: Recommendation[] = [];
    for (const selection of parsed.data.recommendations) {
      const id = `req_${randomUUID()}`;
      recorder.emit(
        "product_selected",
        {
          product_id: selection.product_id,
          source_product_id: products.find(
            (p) => p.product_id === selection.product_id,
          )!.source_product_id,
          quantity: selection.quantity,
          reason_codes: selection.reason_codes,
        },
        "ollama",
        "shopping_agent",
      );
      recorder.emit(
        "tool_proposed",
        { operation: "catalog.get_product", request_id: id },
        "application",
        "collector",
        "catalog.get_product",
      );
      const args = z
        .object({ product_id: identifier })
        .strict()
        .parse({ product_id: selection.product_id });
      recorder.emit(
        "tool_validated",
        { operation: "catalog.get_product", request_id: id, ...args },
        "application",
        "collector",
        "catalog.get_product",
      );
      const [product] = await readCatalog(
        "catalog.get_product",
        id,
        async () => [catalog.getProduct(args.product_id, products)],
      );
      recommendations.push(
        recommendation(
          product,
          selection.quantity,
          selection.reason_codes,
          mandate,
        ),
      );
    }
    store.db.transaction(() => {
      const references: string[] = [];
      for (const r of recommendations)
        references.push(
          recorder.emit(
            "recommendation_recorded",
            {
              product_id: r.product.product_id,
              merchant_id: r.product.merchant_id,
              unit_amount_minor: r.product.unit_amount_minor,
              total_amount_minor: r.total_amount_minor,
              currency: r.product.currency,
              quantity: r.quantity,
              estimate_only: true,
            },
            "application",
            "shopping_agent",
          ),
        );
      store.finishShopping(runId, recommendations, null);
      if (saved.policy.firewall)
        for (const [index, source] of references.entries()) {
          const proposal = recordProposal(store, runId, index, source);
          authorizeProposal(store, proposal.proposal_id);
        }
      recorder.emit("execution_completed", {
        recommendation_count: recommendations.length,
        model_calls: modelCalls,
        tool_calls: toolCalls,
        no_match: parsed.data.status === "no_match",
      });
      recorder.emit("run_finished", { outcome: "recorded" });
    })();
  } catch (error) {
    const failure = controller.signal.aborted
      ? new IntegrationError("timeout")
      : safeFailure(error);
    store.db.transaction(() => {
      recorder.emit("execution_failed", { error_code: failure.code });
      recorder.emit("run_finished", { outcome: "failed" });
      store.finishShopping(runId, [], failure.code);
    })();
  } finally {
    clearTimeout(timer);
  }
  return store.getShopping(runId);
}
