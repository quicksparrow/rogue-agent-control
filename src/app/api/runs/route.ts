import { createRunSchema } from "../../../lib/contracts";
import { getStore } from "../../../server/store";
import { apiError, json, localOnly, readJson } from "../../../server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    localOnly(request);
    return json({ runs: getStore().listRuns() });
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request) {
  try {
    localOnly(request);
    const input = createRunSchema.parse(await readJson(request));
    return json(
      { run: getStore().createRun(input.persona, { policy: input.policy }) },
      201,
    );
  } catch (error) {
    return apiError(error);
  }
}
