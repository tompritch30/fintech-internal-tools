import { getDb } from "../../../lib/auth.ts";
import { loadFlagsServiceConfig } from "../../(platform)/flags/flags.ts";
import { handleFlagsServiceRequest } from "../../(platform)/flags/service.ts";

/**
 * Read-only flag values for services. Only GET is exported, so Next answers every other method
 * with 405. Authenticated by a bearer token, not a session: see service.ts.
 */
export const GET = (request: Request) => handleFlagsServiceRequest(getDb(), request, loadFlagsServiceConfig());
