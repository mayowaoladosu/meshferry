import "server-only";

import { Pool, type QueryResultRow } from "@neondatabase/serverless";

type GlobalWithPool = typeof globalThis & {
  __meshferryPool?: Pool;
};

const globalForPool = globalThis as GlobalWithPool;

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("DATABASE_URL is required. Set it to your Neon pooled PostgreSQL connection string.");
  }
}

export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? process.env.NEON_DATABASE_URL;
  if (!url) throw new DatabaseNotConfiguredError();
  return url;
}

export function getPool(): Pool {
  if (!globalForPool.__meshferryPool) {
    globalForPool.__meshferryPool = new Pool({
      connectionString: getDatabaseUrl(),
      max: Number.parseInt(process.env.DATABASE_POOL_MAX ?? "5", 10),
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000
    });
  }

  return globalForPool.__meshferryPool;
}

export async function query<T extends QueryResultRow>(sql: string, values: readonly unknown[] = []): Promise<T[]> {
  const result = await getPool().query<T>(sql, [...values]);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow>(
  sql: string,
  values: readonly unknown[] = []
): Promise<T | undefined> {
  const rows = await query<T>(sql, values);
  return rows[0];
}

export function toIsoString(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function toNumber(value: string | number | bigint | null | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number.parseInt(value, 10);
  return 0;
}
