import { eventBatchSchema, identifier } from "../../../../../lib/contracts";
import { getStore } from "../../../../../server/store";
import {
  apiError,
  json,
  localOnly,
  readJson,
} from "../../../../../server/http";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  try {
    localOnly(request);
    const { runId } = await context.params;
    const input = eventBatchSchema.parse(await readJson(request));
    const result = getStore().append(identifier.parse(runId), input.events);
    return json(result, result.inserted ? 201 : 200);
  } catch (error) {
    return apiError(error);
  }
}
