import { getStore } from "../../../../server/store";
import { apiError, json, localOnly, readJson } from "../../../../server/http";
import { evaluateReferenceSchema } from "../../../../lib/firewall-contracts";
import {
  authorizeProposal,
  recordRejectedGatewayRequest,
} from "../../../../server/firewall/gateway";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    localOnly(request);
    const raw = await readJson(request);
    const parsed = evaluateReferenceSchema.safeParse(raw);
    if (!parsed.success) {
      recordRejectedGatewayRequest(getStore(), raw);
      throw parsed.error;
    }
    return json(authorizeProposal(getStore(), parsed.data.proposal_id));
  } catch (error) {
    return apiError(error);
  }
}
