import { getStore } from "../../../server/store";
import { apiError, json, localOnly } from "../../../server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    localOnly(request);
    getStore().db.prepare("SELECT 1").get();
    return json({
      status: "ok",
      storage: "sqlite",
      phase: 4,
      integrations: "see_api_integrations",
    });
  } catch (error) {
    return apiError(error);
  }
}
