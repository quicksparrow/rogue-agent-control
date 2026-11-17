import { getStore } from "../../../server/store";
import { json, localOnly, readJson, apiError } from "../../../server/http";
import { investigationRequest } from "../../../lib/investigation-contracts";
import { assembleEvidence } from "../../../server/investigation/evidence";
import { artifacts, investigate } from "../../../server/investigation/service";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    localOnly(request);
    const input = investigationRequest.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const store = getStore();
    return json({
      evidence: assembleEvidence(store, input.run_id),
      artifacts: artifacts(store, input.run_id),
      execution: store.detail(input.run_id).shopping ?? null,
    });
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(request: Request) {
  try {
    localOnly(request);
    const input = investigationRequest.parse(await readJson(request));
    return json({ artifact: await investigate(getStore(), input.run_id) });
  } catch (e) {
    return apiError(e);
  }
}
