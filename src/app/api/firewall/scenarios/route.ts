import { z } from "zod";
import { scenarioIds } from "../../../../lib/firewall-contracts";
import { getStore } from "../../../../server/store";
import { apiError, json, localOnly, readJson } from "../../../../server/http";
import { createFirewallScenario } from "../../../../server/firewall/scenarios";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    localOnly(request);
    const body = z
      .object({ scenario: z.enum(scenarioIds) })
      .strict()
      .parse(await readJson(request));
    return json(createFirewallScenario(getStore(), body.scenario), 201);
  } catch (error) {
    return apiError(error);
  }
}
