import { createHash } from "node:crypto";
import { z } from "zod";
import { currency, identifier } from "../../lib/contracts";
import {
  decimalToMinor,
  productSchema,
  searchArgumentsSchema,
  type CatalogMode,
  type Product,
} from "../../lib/shopping-contracts";
import { IntegrationError } from "./errors";
import { boundedJson, type Fetcher } from "./network";
import { safeSourceUrl, safeText } from "./sanitize";

const seed = (
  id: string,
  title: string,
  merchant: string,
  price: string,
  availability: Product["availability"] = "in_stock",
): Product => ({
  product_id: id,
  source_product_id: id,
  title,
  merchant_id: merchant,
  unit_amount_minor: decimalToMinor(price),
  currency: "USD",
  availability,
  source: "offline",
  source_reference: `seed_catalog_v1:${id}`,
  description_omitted: true,
});
export const seededProducts: readonly Product[] = Object.freeze([
  seed(
    "seed_shoes_daily",
    "Seeded · Stride Everyday Running Shoes",
    "seed_sports",
    "89.95",
  ),
  seed(
    "seed_shoes_light",
    "Seeded · Pace Lightweight Running Shoes",
    "seed_sports",
    "109.99",
  ),
  seed(
    "seed_shoes_premium",
    "Seeded · Summit Premium Running Shoes",
    "seed_outdoors",
    "149.00",
  ),
  seed(
    "seed_shoes_clearance",
    "Seeded · Stride Running Shoes Clearance",
    "seed_sports",
    "69.95",
    "out_of_stock",
  ),
  seed(
    "seed_mouse_basic",
    "Seeded · Everyday Wireless Mouse USB Receiver",
    "seed_office",
    "14.95",
  ),
  seed(
    "seed_mouse_silent",
    "Seeded · Quiet Wireless Mouse Ergonomic USB",
    "seed_office",
    "19.99",
  ),
  seed(
    "seed_mouse_pro",
    "Seeded · Pro Wireless Mouse Bluetooth",
    "seed_tech",
    "34.50",
  ),
  seed(
    "seed_keyboard",
    "Seeded · Compact Wireless Keyboard",
    "seed_office",
    "29.95",
  ),
]);

export interface Catalog {
  readonly mode: CatalogMode;
  search(
    args: z.infer<typeof searchArgumentsSchema>,
    code: z.infer<typeof currency>,
    signal?: AbortSignal,
  ): Promise<Product[]>;
  getProduct(id: string, observed: readonly Product[]): Product;
}
function getObserved(id: string, observed: readonly Product[]) {
  identifier.parse(id);
  const product = observed.find((p) => p.product_id === id);
  if (!product) throw new IntegrationError("ungrounded_product");
  return productSchema.parse(product);
}
export class OfflineCatalog implements Catalog {
  readonly mode = "offline" as const;
  async search(input: z.infer<typeof searchArgumentsSchema>) {
    const args = searchArgumentsSchema.parse(input);
    const tokens = args.query
      .toLowerCase()
      .replace(/mice/g, "mouse")
      .replace(/shoes/g, "shoe")
      .split(/\W+/)
      .filter(
        (t) =>
          t.length > 2 &&
          ![
            "find",
            "under",
            "everyday",
            "office",
            "our",
            "for",
            "with",
            "total",
            "budget",
          ].includes(t),
      );
    return seededProducts
      .map((p, index) => ({
        p,
        index,
        score: tokens.filter((t) =>
          p.title.toLowerCase().replace(/shoes/g, "shoe").includes(t),
        ).length,
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, args.limit)
      .map((x) => ({ ...x.p }));
  }
  getProduct = getObserved;
}

// Contract inspected from official @channel3/sdk 4.8.0 (POST /v1/search).
// A product can have several merchant offers; each offer becomes a grounded candidate.
const rawProduct = z.object({
  id: identifier,
  title: z.string().max(2000),
  offers: z
    .array(
      z.object({
        domain: z.string().max(200),
        url: z.string().max(4000),
        price: z.object({
          price: z.union([z.number(), z.string()]),
          currency: z.string(),
        }),
        availability: z.string().optional(),
      }),
    )
    .max(100)
    .optional(),
});
const searchResponse = z.object({ products: z.array(z.unknown()).max(100) });

export class Channel3Catalog implements Catalog {
  readonly mode = "channel3" as const;
  constructor(
    private options: {
      apiKey?: string;
      timeoutMs?: number;
      fetcher?: Fetcher;
    } = {},
  ) {}
  async search(
    input: z.infer<typeof searchArgumentsSchema>,
    code: z.infer<typeof currency>,
    signal?: AbortSignal,
  ) {
    const args = searchArgumentsSchema.parse(input);
    const apiKey = this.options.apiKey ?? process.env.CHANNEL3_API_KEY;
    if (!apiKey) throw new IntegrationError("not_configured");
    const raw = await boundedJson(
      "https://api.trychannel3.com/v1/search",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "X-Channel3-Currency": code,
        },
        body: JSON.stringify(args),
      },
      this.options.timeoutMs ?? 15000,
      this.options.fetcher,
      signal,
    );
    const response = searchResponse.safeParse(raw);
    if (!response.success) throw new IntegrationError("malformed_catalog");
    const products: Product[] = [];
    for (const item of response.data.products) {
      const row = rawProduct.safeParse(item);
      if (!row.success) continue;
      for (const offer of row.data.offers ?? []) {
        try {
          const merchant = identifier.parse(
            offer.domain.toLowerCase().replace(/^www\./, ""),
          );
          const ref = safeSourceUrl(offer.url);
          if (
            safeText(row.data.id, 96) !== row.data.id ||
            safeText(merchant, 96) !== merchant
          )
            continue;
          products.push(
            productSchema.parse({
              product_id: `c3_${createHash("sha256").update(`${row.data.id}:${merchant}`).digest("hex").slice(0, 20)}`,
              source_product_id: row.data.id,
              title: safeText(row.data.title, 120) || "Untitled product",
              merchant_id: merchant,
              unit_amount_minor: decimalToMinor(offer.price.price),
              currency: currency.parse(offer.price.currency),
              availability:
                offer.availability === "InStock"
                  ? "in_stock"
                  : offer.availability === "OutOfStock"
                    ? "out_of_stock"
                    : "unknown",
              source: "channel3",
              source_reference: ref,
              description_omitted: true,
            }),
          );
        } catch {
          /* Invalid/unsupported offers are omitted, never invented or currency-converted. */
        }
      }
    }
    if (response.data.products.length && !products.length)
      throw new IntegrationError("malformed_catalog");
    return [...new Map(products.map((p) => [p.product_id, p])).values()].slice(
      0,
      args.limit,
    );
  }
  // Retrieval is from this execution's captured offers, never an arbitrary model URL.
  getProduct = getObserved;
}
