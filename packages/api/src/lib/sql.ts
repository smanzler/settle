import { sql } from "drizzle-orm";

/** `excluded.<column>` — the value the failed INSERT tried to write. */
export const sqlExcluded = (column: string) =>
  sql`excluded.${sql.identifier(column)}`;
