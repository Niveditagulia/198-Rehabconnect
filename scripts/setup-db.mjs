import {createClient} from '@libsql/client';
import {schema} from '../lib/schema.ts';
if (!process.env.TURSO_DATABASE_URL) throw new Error('Set TURSO_DATABASE_URL in .env.local.');
const client=createClient({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN});
await client.batch(schema,'write');
client.close();
console.log('RehabConnect database is ready.');
