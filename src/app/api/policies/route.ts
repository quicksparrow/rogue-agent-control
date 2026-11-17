import { getStore } from "../../../server/store";
import { apiError, json, localOnly, readJson } from "../../../server/http";
import {
  ensureOwnerPolicies,
  createOwnerPolicy,
} from "../../../server/firewall/policies";
import { localIdentity } from "../../../server/identity";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    localOnly(request);
    return json({
      ...ensureOwnerPolicies(getStore()),
      identity: localIdentity(),
      payment_adapter_installed: false,
    });
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request) {
  try {
    localOnly(request);
    ensureOwnerPolicies(getStore());
    return json(
      { policy: createOwnerPolicy(getStore(), await readJson(request)) },
      201,
    );
  } catch (error) {
    return apiError(error);
  }
}
