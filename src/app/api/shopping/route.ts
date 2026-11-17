import { getStore } from "../../../server/store";
import { apiError, json, localOnly, readJson } from "../../../server/http";
import { createControlledShoppingRun } from "../../../server/firewall/shopping";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    localOnly(request);
    const run = createControlledShoppingRun(
      getStore(),
      await readJson(request),
    );
    return json({ run, execution: getStore().getShopping(run.run_id) }, 201);
  } catch (error) {
    return apiError(error);
  }
}
