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

// ── Production safety guard ──
// Block migrations against known production hosts when running locally.
// On Vercel, VERCEL_ENV is set and migrations are expected to target production.
const KNOWN_PRODUCTION_HOSTS = [
  'ep-odd-feather-a7mrocqy-pooler.ap-southeast-2.aws.neon.tech',
];

if (!process.env.VERCEL_ENV) {
  try {
    const host = new URL(databaseUrl).hostname.toLowerCase();
    if (
      KNOWN_PRODUCTION_HOSTS.some((h) => host === h) ||
      /\bprod(uction)?\b/i.test(host)
    ) {
      console.error(
        `[FATAL] db-migrate — DATABASE_URL points to PRODUCTION (${host}).\n` +
        `Migrations cannot be run locally against production.\n` +
        `Set DATABASE_URL to a development/test branch in .env.local.`
      );
      process.exit(1);
    }
  } catch {}
}

const parsedHost = (() => {
  try { return new URL(databaseUrl).hostname; } catch { return databaseUrl.slice(0, 40); }
})();
console.log(`Migrating database: ${parsedHost}`);


async function run() {
  const db = drizzle({ client: neon(databaseUrl) });
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('Drizzle migrations applied successfully.');
}

run().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
