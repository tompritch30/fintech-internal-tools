import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.ts";

export * from "./schema.ts";
export { schema };

export type Db = NodePgDatabase<typeof schema> & { $client: pg.Pool };
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** A database handle or an open transaction. */
export type Executor = Db | Tx;

export function createDb(connectionString: string, options: { max?: number } = {}): Db {
  const pool = new pg.Pool({ connectionString, max: options.max ?? 10 });
  return drizzle(pool, { schema }) as Db;
}
