import { createClient, type Client, type InValue } from '@libsql/client';
import { schema } from './schema';
import { Pool, types } from 'pg';
import { supabaseCa } from './supabase-ca';
types.setTypeParser(20, Number);
type Input = {sql:string; args:InValue[]};
function statement(input:Input) {
  let position = 0;
  return {
    text: input.sql.replace(/\?/g, () => '$' + ++position)
      .replace(/\bAS (\w*[A-Z]\w*)/g, 'AS "$1"'),
    values: input.args,
  };
}
class Postgres {
  constructor(readonly pool:Pool) {}
  async execute(input:Input) {
    const result = await this.pool.query(statement(input));
    return {rows:result.rows, rowsAffected:result.rowCount ?? 0};
  }
  async batch(inputs:(Input|string)[], _mode:string) {
    const connection = await this.pool.connect();
    try {
      await connection.query('BEGIN');
      for (const input of inputs) await connection.query(typeof input === 'string' ? input : statement(input));
      await connection.query('COMMIT');
    } catch(error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally { connection.release(); }
  }
}
let postgres:Postgres | undefined;
let client: Client | undefined;
let initialized: Promise<unknown> | undefined;
export function databaseClient() {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    if (!url) throw new Error('Set TURSO_DATABASE_URL before running the app.');
    client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  return client;
}
export async function getDatabase() {
  const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (url) {
    if (!postgres) {
      const connection = new URL(url);
      const isSupabasePooler = connection.hostname.endsWith('.pooler.supabase.com');
      if (isSupabasePooler) {
        // URL parameters would override the verified TLS configuration below.
        for (const key of ['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert']) {
          connection.searchParams.delete(key);
        }
      }
      postgres = new Postgres(new Pool({
        connectionString: connection.toString(),
        max: 2,
        connectionTimeoutMillis: 5000,
        ...(isSupabasePooler ? {ssl: {ca: supabaseCa, rejectUnauthorized: true}} : {}),
      }));
    }
    return new Database(postgres);
  }
  if (process.env.VERCEL) throw new Error('Set POSTGRES_URL to the Supabase transaction pooler URL.');
  const client = databaseClient();
  if (!initialized) initialized = client.batch(schema, 'write').catch(error => { initialized = undefined; throw error; });
  await initialized;
  return new Database(client);
}
class Statement {
  constructor(readonly client: Client | Postgres, readonly sql: string, readonly args: InValue[] = []) {}
  bind(...args: InValue[]) { return new Statement(this.client, this.sql, args); }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const result = await this.client.execute({sql: this.sql, args: this.args});
    return result.rows.length ? result.rows[0] as unknown as T : null;
  }
  async all<T = Record<string, unknown>>() {
    const result = await this.client.execute({sql: this.sql, args: this.args});
    return { results: result.rows as unknown as T[] };
  }
  async run() {
    const result = await this.client.execute({sql: this.sql, args: this.args});
    return { meta: {changes: result.rowsAffected} };
  }
}
export class Database {
  constructor(readonly client: Client | Postgres) {}
  prepare(sql: string) { return new Statement(this.client, sql); }
  async batch(statements: Statement[]) {
    return this.client.batch(statements.map(s => ({sql: s.sql, args: s.args})), 'write');
  }
}
