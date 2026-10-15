import type { Db } from "@fit/db";
import type { FlagsServiceConfig } from "./flags.ts";

/** GET /api/flags?environment=prod with `Authorization: Bearer <FLAGS_SERVICE_TOKEN>`. Read-only. */
export async function handleFlagsServiceRequest(_db: Db, _request: Request, _config: FlagsServiceConfig): Promise<Response> {
  throw new Error("not implemented");
}
