import { getStore } from "../../../server/store";
import { json, localOnly, readJson, apiError } from "../../../server/http";
import { replay } from "../../../server/investigation/replay-service";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    localOnly(request);
    return json({ artifact: replay(getStore(), await readJson(request)) });
  } catch (e) {
    return apiError(e);
  }
}
