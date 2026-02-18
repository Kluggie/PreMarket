import dotenv from 'dotenv';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { sql } from 'drizzle-orm';

dotenv.config({ path: '.env.local' });
dotenv.config();

const databaseUrl = (process.env.DATABASE_URL || '').trim();

if (!databaseUrl || databaseUrl.includes('<') || databaseUrl.includes('>')) {
  console.error('A valid DATABASE_URL is required for db smoke test.');
  process.exit(1);
}

async function run() {
  const db = drizzle({ client: neon(databaseUrl) });
  const ping = await db.execute(sql`select 1 as ok`);
  const tables = await db.execute(
    sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
  );

  console.log('DB ping:', ping.rows?.[0] || ping);
  console.log('Public tables:', (tables.rows || []).map((row) => row.table_name));
}

run().catch((error) => {
  console.error('DB smoke failed:', error);
  process.exit(1);
});
