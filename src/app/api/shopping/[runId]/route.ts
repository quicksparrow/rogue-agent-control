import { identifier } from "../../../../lib/contracts";
import { getStore } from "../../../../server/store";
import { apiError, json, localOnly } from "../../../../server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  try {
    localOnly(request);
    const { runId } = await context.params;
    return json({ execution: getStore().getShopping(identifier.parse(runId)) });
  } catch (error) {
    return apiError(error);
  }
}
