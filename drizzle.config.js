import dotenv from 'dotenv';
import { defineConfig } from 'drizzle-kit';

dotenv.config({ path: '.env.local' });
dotenv.config();

const databaseUrl = (process.env.DATABASE_URL || '').trim();

// SAFETY: Fail fast if DATABASE_URL is missing or invalid
// This prevents silent fallback to ephemeral/local databases
if (!databaseUrl) {
  throw new Error(
    'drizzle.config.js: DATABASE_URL environment variable is required. ' +
    'Set it in .env.local for local development or in Vercel Environment Variables for deployments.',
  );
}

if (databaseUrl.includes('<') || databaseUrl.includes('>') || databaseUrl.includes('localhost:5432/premarket')) {
  throw new Error(
    'drizzle.config.js: DATABASE_URL appears to be a placeholder or local fallback. ' +
    'Set a valid Neon/Postgres connection string.',
  );
}

export default defineConfig({
  schema: './server/_lib/db/schema.js',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
  strict: true,
  verbose: true,
});
