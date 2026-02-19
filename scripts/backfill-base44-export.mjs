import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { schema } from '../server/_lib/db/client.js';

dotenv.config({ path: '.env.local' });
dotenv.config();

const databaseUrl = (process.env.DATABASE_URL || '').trim();

if (!databaseUrl || databaseUrl.includes('<') || databaseUrl.includes('>')) {
  console.error('A valid DATABASE_URL is required for backfill.');
  process.exit(1);
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function toDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function run() {
  const argvPath = process.argv[2];
  const cwd = process.cwd();
  const defaultPath = path.resolve(cwd, 'data/base44-export.json');
  const inputPath = argvPath ? path.resolve(cwd, argvPath) : defaultPath;

  const raw = await fs.readFile(inputPath, 'utf8');
  const parsed = JSON.parse(raw);

  const users = normalizeArray(parsed.users || parsed.user || []);
  const proposals = normalizeArray(parsed.proposals || parsed.proposal || []);
  const sharedLinks = normalizeArray(parsed.sharedLinks || parsed.shareLinks || []);
  const billingReferences = normalizeArray(parsed.billing || parsed.billingReferences || []);

  const db = drizzle({ client: neon(databaseUrl), schema });

  let usersCount = 0;
  for (const row of users) {
    const id = String(row.id || row.sub || '').trim();
    const email = String(row.email || '').trim();
    if (!id || !email) continue;

    await db
      .insert(schema.users)
      .values({
        id,
        email,
        fullName: row.full_name || row.fullName || row.name || null,
        picture: row.picture || null,
        role: row.role || 'user',
        createdAt: toDate(row.created_date || row.createdAt) || new Date(),
        updatedAt: toDate(row.updated_date || row.updatedAt) || new Date(),
        lastLoginAt: toDate(row.last_login_at || row.lastLoginAt),
      })
      .onConflictDoUpdate({
        target: schema.users.id,
        set: {
          email,
          fullName: row.full_name || row.fullName || row.name || null,
          picture: row.picture || null,
          role: row.role || 'user',
          updatedAt: new Date(),
        },
      });

    usersCount += 1;
  }

  let proposalsCount = 0;
  for (const row of proposals) {
    const id = String(row.id || '').trim();
    const userId = String(row.user_id || row.userId || row.party_a_user_id || '').trim();
    if (!id || !userId) continue;

    await db
      .insert(schema.proposals)
      .values({
        id,
        userId,
        title: row.title || 'Untitled proposal',
        status: row.status || 'draft',
        templateName: row.template_name || row.templateName || null,
        partyAEmail: row.party_a_email || row.partyAEmail || null,
        partyBEmail: row.party_b_email || row.partyBEmail || null,
        summary: row.summary || null,
        payload: row.payload || row.data || {},
        createdAt: toDate(row.created_date || row.createdAt) || new Date(),
        updatedAt: toDate(row.updated_date || row.updatedAt) || new Date(),
      })
      .onConflictDoUpdate({
        target: schema.proposals.id,
        set: {
          title: row.title || 'Untitled proposal',
          status: row.status || 'draft',
          templateName: row.template_name || row.templateName || null,
          partyAEmail: row.party_a_email || row.partyAEmail || null,
          partyBEmail: row.party_b_email || row.partyBEmail || null,
          summary: row.summary || null,
          payload: row.payload || row.data || {},
          updatedAt: new Date(),
        },
      });

    proposalsCount += 1;
  }

  let sharedLinksCount = 0;
  for (const row of sharedLinks) {
    const id = String(row.id || '').trim();
    const token = String(row.token || '').trim();
    const userId = String(row.user_id || row.userId || '').trim();
    const proposalId = String(row.proposal_id || row.proposalId || row.source_proposal_id || '').trim();
    if (!id || !token || !userId || !proposalId) continue;

    await db
      .insert(schema.sharedLinks)
      .values({
        id,
        token,
        userId,
        proposalId,
        recipientEmail: row.recipient_email || row.recipientEmail || null,
        status: row.status || 'active',
        maxUses: Number(row.max_uses || row.maxUses || 1),
        uses: Number(row.uses || 0),
        expiresAt: toDate(row.expires_at || row.expiresAt),
        idempotencyKey: row.idempotency_key || row.idempotencyKey || null,
        reportMetadata: row.report_metadata || row.reportMetadata || {},
        createdAt: toDate(row.created_date || row.createdAt) || new Date(),
        updatedAt: toDate(row.updated_date || row.updatedAt) || new Date(),
      })
      .onConflictDoUpdate({
        target: schema.sharedLinks.token,
        set: {
          recipientEmail: row.recipient_email || row.recipientEmail || null,
          status: row.status || 'active',
          maxUses: Number(row.max_uses || row.maxUses || 1),
          uses: Number(row.uses || 0),
          expiresAt: toDate(row.expires_at || row.expiresAt),
          reportMetadata: row.report_metadata || row.reportMetadata || {},
          updatedAt: new Date(),
        },
      });

    sharedLinksCount += 1;
  }

  let billingCount = 0;
  for (const row of billingReferences) {
    const userId = String(row.user_id || row.userId || row.id || '').trim();
    if (!userId) continue;

    await db
      .insert(schema.billingReferences)
      .values({
        userId,
        stripeCustomerId: row.stripe_customer_id || row.stripeCustomerId || null,
        stripeSubscriptionId: row.stripe_subscription_id || row.stripeSubscriptionId || null,
        plan: row.plan_tier || row.plan || 'starter',
        status: row.subscription_status || row.status || 'inactive',
        cancelAtPeriodEnd: Boolean(row.cancel_at_period_end || row.cancelAtPeriodEnd),
        currentPeriodEnd: toDate(row.current_period_end || row.currentPeriodEnd),
        createdAt: toDate(row.created_date || row.createdAt) || new Date(),
        updatedAt: toDate(row.updated_date || row.updatedAt) || new Date(),
      })
      .onConflictDoUpdate({
        target: schema.billingReferences.userId,
        set: {
          stripeCustomerId: row.stripe_customer_id || row.stripeCustomerId || null,
          stripeSubscriptionId: row.stripe_subscription_id || row.stripeSubscriptionId || null,
          plan: row.plan_tier || row.plan || 'starter',
          status: row.subscription_status || row.status || 'inactive',
          cancelAtPeriodEnd: Boolean(row.cancel_at_period_end || row.cancelAtPeriodEnd),
          currentPeriodEnd: toDate(row.current_period_end || row.currentPeriodEnd),
          updatedAt: new Date(),
        },
      });

    billingCount += 1;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        inputPath,
        usersUpserted: usersCount,
        proposalsUpserted: proposalsCount,
        sharedLinksUpserted: sharedLinksCount,
        billingUpserted: billingCount,
      },
      null,
      2,
    ),
  );
}

run().catch((error) => {
  console.error('Backfill failed:', error);
  process.exit(1);
});
