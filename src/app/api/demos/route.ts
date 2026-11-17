import { demoSchema } from "../../../lib/contracts";
import { getStore } from "../../../server/store";
import { scenarioEvents } from "../../../server/fixtures";
import { apiError, json, localOnly, readJson } from "../../../server/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    localOnly(request);
    const input = demoSchema.parse(await readJson(request));
    return json(
      {
        run: getStore().createSynthetic(
          input.persona,
          input.scenario,
          scenarioEvents,
        ),
      },
      201,
    );
  } catch (error) {
    return apiError(error);
  }
}
