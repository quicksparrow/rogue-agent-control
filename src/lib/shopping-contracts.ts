import { z } from "zod";
import {
  currency,
  identifier,
  personaSchema,
  type PolicySnapshot,
} from "./contracts";
import type { FirewallView } from "./firewall-contracts";

export const catalogModeSchema = z.enum(["offline", "channel3"]);
export type CatalogMode = z.infer<typeof catalogModeSchema>;
export const searchQuerySchema = z
  .string()
  .trim()
  .min(2)
  .max(100)
  .regex(/^[\p{L}\p{N} ,.'-]+$/u);
export const searchArgumentsSchema = z
  .object({ query: searchQuerySchema, limit: z.number().int().min(1).max(4) })
  .strict();
export const toolDecisionSchema = z
  .object({
    tool: z.literal("catalog.search"),
    arguments: searchArgumentsSchema,
  })
  .strict();
export const reasonCodes = [
  "price",
  "preferences",
  "availability",
  "budget_fit",
  "closest_match",
] as const;
export const recommendationDecisionSchema = z
  .object({
    status: z.enum(["recommendations", "no_match"]),
    recommendations: z
      .array(
        z
          .object({
            product_id: identifier,
            quantity: z.number().int().min(1).max(10000),
            reason_codes: z.array(z.enum(reasonCodes)).min(1).max(3),
          })
          .strict(),
      )
      .max(2),
  })
  .strict();

export const shoppingInputSchema = z
  .object({
    persona: personaSchema,
    catalog_mode: catalogModeSchema,
    objective: z.string().trim().min(5).max(360),
    budget_minor: z.number().int().min(1).max(100_000_000),
    currency,
    quantity: z.number().int().min(1).max(10000),
    preferences: z.array(z.string().trim().min(1).max(80)).max(4),
    merchant_ids: z.array(identifier).min(1).max(10),
  })
  .strict();
export type ShoppingInput = z.infer<typeof shoppingInputSchema>;

export interface LocalIdentity {
  owner_id: string;
  agent_id: string;
  attribution: "application_configuration";
  authenticated: false;
  authorized_context: "recommendations_only" | "policy_controlled_proposals";
}
export interface Mandate extends ShoppingInput {
  mandate_id: string;
  identity: LocalIdentity;
  created_at: string;
  omitted_sensitive_fields: number;
  firewall?: { owner_policy_version: string; registry_version: string };
}

export const productSchema = z
  .object({
    product_id: identifier,
    source_product_id: identifier,
    title: z.string().min(1).max(120),
    merchant_id: identifier,
    unit_amount_minor: z.number().int().min(0).max(1_000_000_000),
    currency,
    availability: z.enum(["in_stock", "out_of_stock", "unknown"]),
    source: catalogModeSchema,
    source_reference: z.string().max(600),
    description_omitted: z.literal(true),
  })
  .strict();
export type Product = z.infer<typeof productSchema>;
export interface Recommendation {
  product: Product;
  quantity: number;
  total_amount_minor: number;
  reason_codes: (typeof reasonCodes)[number][];
  discrepancies: string[];
  estimate_only: true;
}
export type ShoppingStatus = "pending" | "running" | "completed" | "failed";
export interface ShoppingExecution {
  run_id: string;
  mandate: Mandate;
  policy: PolicySnapshot;
  status: ShoppingStatus;
  products: Product[];
  recommendations: Recommendation[];
  error_code: string | null;
  firewall?: FirewallView;
  evidence_mode?: "synthetic_fixture";
}

/** Exact decimal parsing for the supported two-decimal currencies. Never round float prices. */
export function decimalToMinor(value: string | number): number {
  const text = String(value).trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(text))
    throw new Error("Invalid two-decimal price");
  const [whole, fraction = ""] = text.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result) || result > 1_000_000_000)
    throw new Error("Price outside supported range");
  return result;
}

export function estimateTotal(unit: number, quantity: number) {
  if (
    !Number.isSafeInteger(unit) ||
    unit < 0 ||
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    quantity > 10000
  )
    throw new Error("Invalid cost arguments");
  const total = unit * quantity;
  if (!Number.isSafeInteger(total)) throw new Error("Estimate overflow");
  return total;
}
