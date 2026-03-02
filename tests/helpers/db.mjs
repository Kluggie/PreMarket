import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';
import { sql } from 'drizzle-orm';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

let migrated = false;

function getValidDatabaseUrl() {
  const databaseUrl = (process.env.DATABASE_URL || '').trim();

  if (!databaseUrl || databaseUrl.includes('<') || databaseUrl.includes('>')) {
    return null;
  }

  try {
    const parsed = new URL(databaseUrl);
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
      return null;
    }
    return databaseUrl;
  } catch {
    return null;
  }
}

export function hasDatabaseUrl() {
  return Boolean(getValidDatabaseUrl());
}

export function getDb() {
  const databaseUrl = getValidDatabaseUrl();
  if (!databaseUrl) {
    throw new Error('A valid DATABASE_URL is required');
  }

  return drizzle({ client: neon(databaseUrl) });
}

export async function ensureMigrated() {
  if (migrated) return;
  const db = getDb();
  await migrate(db, { migrationsFolder: './drizzle' });
  migrated = true;
}

export async function resetTables() {
  const db = getDb();
  await db.execute(
    sql`truncate table
      audit_logs,
      memberships,
      organizations,
      user_profiles,
      contact_requests,
      beta_applications,
      notifications,
      email_dedupes,
      email_verification_tokens,
      shared_report_deliveries,
      shared_report_recipient_revisions,
      shared_report_evaluation_runs,
      shared_link_responses,
      snapshot_access,
      proposal_snapshots,
      proposal_evaluations,
      document_comparison_coach_cache,
      proposal_responses,
      document_comparisons,
      template_questions,
      template_sections,
      templates,
      shared_links,
      proposals,
      billing_references,
      users
      restart identity cascade`,
  );
}
