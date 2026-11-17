import { z } from "zod";
import { identifier } from "../../../../../lib/contracts";
import { getStore } from "../../../../../server/store";
import {
  apiError,
  json,
  localOnly,
  readJson,
} from "../../../../../server/http";
import { executeShoppingRun } from "../../../../../server/shopping/runtime";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  try {
    localOnly(request);
    z.object({})
      .strict()
      .parse(await readJson(request));
    const { runId } = await context.params;
    return json({
      execution: await executeShoppingRun(getStore(), identifier.parse(runId)),
    });
  } catch (error) {
    return apiError(error);
  }
}
