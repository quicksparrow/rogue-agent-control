import { apiError, json, localOnly } from "../../../server/http";
import { demoQuery } from "../../../lib/demo-contracts";
import { demoSnapshot } from "../../../server/demo";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    localOnly(request);
    const params = new URL(request.url).searchParams;
    if (params.getAll("scenario").length !== 1)
      return json({ error: "Choose exactly one scenario" }, 400);
    const { scenario } = demoQuery.parse(Object.fromEntries(params));
    return json(demoSnapshot(scenario));
  } catch (error) {
    return apiError(error);
  }
}
