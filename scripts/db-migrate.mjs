import dotenv from 'dotenv';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';

dotenv.config({ path: '.env.local' });
dotenv.config();

const databaseUrl = (process.env.DATABASE_URL || '').trim();

if (!databaseUrl || databaseUrl.includes('<') || databaseUrl.includes('>')) {
  console.error('A valid DATABASE_URL is required to run migrations.');
  process.exit(1);
}

async function run() {
  const db = drizzle({ client: neon(databaseUrl) });
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('Drizzle migrations applied successfully.');
}

run().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
