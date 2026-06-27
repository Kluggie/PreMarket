import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq } from 'drizzle-orm';
import proposalsHandler from '../../server/routes/proposals/index.ts';
import proposalArchiveHandler from '../../server/routes/proposals/[id]/archive.ts';
import proposalDetailHandler from '../../server/routes/proposals/[id].ts';
import proposalEvaluateHandler from '../../server/routes/proposals/[id]/evaluate.ts';
import proposalSendHandler from '../../server/routes/proposals/[id]/send.ts';
import templateUseHandler from '../../server/routes/templates/[id]/use.ts';
import documentComparisonsHandler from '../../server/routes/document-comparisons/index.ts';
import sharedReportsHandler from '../../server/routes/shared-reports/index.ts';
import sharedReportSendHandler from '../../server/routes/shared-reports/[token]/send.ts';
import documentsHandler from '../../server/routes/documents/index.ts';
import documentsExtractHandler from '../../server/routes/documents/extract.ts';
import {
  assertAiAssistanceAllowed,
  assertStarterAiEvaluationAllowed,
  recordAiAssistanceUsage,
  releaseAiMediationReviewReservation,
  reserveAiMediationReviewCredit,
  getAiMediationReviewLimitForPlan,
  getStarterUsageSnapshot,
} from '../../server/_lib/starter-entitlements.ts';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';
import * as schema from '../../server/_lib/db/schema.js';

ensureTestEnv();

const MB = 1024 * 1024;

function serialTest(name, optionsOrFn, maybeFn) {
  if (typeof optionsOrFn === 'function') {
    return test(name, { concurrency: 1 }, optionsOrFn);
  }

  const options = optionsOrFn && typeof optionsOrFn === 'object' ? optionsOrFn : {};
  const fn = typeof maybeFn === 'function' ? maybeFn : () => {};
  return test(name, { ...options, concurrency: 1 }, fn);
}

function authCookie(userId, email) {
  return makeSessionCookie({ sub: userId, email });
}

async function getDb() {
  const sql = neon(process.env.DATABASE_URL);
  return drizzle(sql, { schema });
}

async function seedUserAndPlan(userId, email, plan = 'starter') {
  const db = await getDb();
  await db
    .insert(schema.users)
    .values({ id: userId, email })
    .onConflictDoNothing({ target: schema.users.id });

  await db
    .insert(schema.billingReferences)
    .values({
      userId,
      plan,
      status: 'active',
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.billingReferences.userId,
      set: {
        plan,
        status: 'active',
        updatedAt: new Date(),
      },
    });
}

async function seedProposal(userId, title, partial = {}) {
  const db = await getDb();
  await db.insert(schema.proposals).values({
    id: partial.id || `proposal_${Math.random().toString(36).slice(2, 10)}`,
    userId,
    title,
    status: partial.status || 'draft',
    templateId: null,
    templateName: null,
    proposalType: 'standard',
    draftStep: 1,
    sourceProposalId: null,
    documentComparisonId: null,
    partyAEmail: partial.partyAEmail || null,
    partyBEmail: partial.partyBEmail || null,
    summary: null,
    payload: {},
    sentAt: partial.sentAt || null,
    receivedAt: partial.receivedAt || null,
    createdAt: partial.createdAt || new Date(),
    updatedAt: partial.updatedAt || new Date(),
    closedAt: partial.closedAt || null,
    archivedAt: partial.archivedAt || null,
    archivedByPartyAAt: partial.archivedByPartyAAt || null,
    deletedByPartyAAt: partial.deletedByPartyAAt || null,
    partyAOutcome: partial.partyAOutcome || null,
    partyAOutcomeAt: partial.partyAOutcomeAt || null,
    partyBOutcome: partial.partyBOutcome || null,
    partyBOutcomeAt: partial.partyBOutcomeAt || null,
  });
}

async function createProposalViaApi(cookie, title = 'New Proposal') {
  const req = createMockReq({
    method: 'POST',
    url: '/api/proposals',
    headers: { cookie },
    body: {
      title,
      party_b_email: 'recipient@example.com',
    },
  });
  const res = createMockRes();
  await proposalsHandler(req, res);
  return { status: res.statusCode, body: res.jsonBody() };
}

async function createComparisonViaApi(cookie, overrides = {}) {
  const req = createMockReq({
    method: 'POST',
    url: '/api/document-comparisons',
    headers: { cookie },
    body: {
      title: overrides.title || 'Starter Comparison',
      createProposal: true,
      docAText: overrides.docAText || 'Private owner context for Starter quota tests.',
      docBText: overrides.docBText || 'Shared opportunity context for Starter quota tests.',
      recipientEmail: overrides.recipientEmail || overrides.recipient_email || null,
      recipientName: overrides.recipientName || overrides.recipient_name || null,
    },
  });
  const res = createMockRes();
  await documentComparisonsHandler(req, res);
  return { status: res.statusCode, body: res.jsonBody() };
}

async function createSharedReportLinkViaApi(cookie, comparisonId, recipientEmail, overrides = {}) {
  const req = createMockReq({
    method: 'POST',
    url: '/api/sharedReports',
    headers: { cookie },
    body: {
      comparisonId,
      recipientEmail,
      canEdit: true,
      canEditConfidential: true,
      canReevaluate: true,
      canSendBack: true,
      maxUses: 50,
      ...overrides,
    },
  });
  const res = createMockRes();
  await sharedReportsHandler(req, res);
  return { status: res.statusCode, body: res.jsonBody() };
}

async function useTemplateViaApi(cookie, templateId, overrides = {}) {
  const req = createMockReq({
    method: 'POST',
    url: `/api/templates/${templateId}/use`,
    headers: { cookie },
    query: { id: templateId },
    body: {
      title: overrides.title || 'from template',
      ...overrides,
    },
  });
  const res = createMockRes();
  await templateUseHandler(req, res, templateId);
  return { status: res.statusCode, body: res.jsonBody() };
}

async function sendProposalViaApi(cookie, proposalId, recipientEmail, overrides = {}) {
  const req = createMockReq({
    method: 'POST',
    url: `/api/proposals/${proposalId}/send`,
    headers: { cookie },
    query: { id: proposalId },
    body: {
      recipientEmail,
      createShareLink: true,
      ...overrides,
    },
  });
  const res = createMockRes();
  await proposalSendHandler(req, res, proposalId);
  return { status: res.statusCode, body: res.jsonBody() };
}

async function sendSharedReportViaApi(cookie, token, recipientEmail) {
  const req = createMockReq({
    method: 'POST',
    url: `/api/sharedReports/${token}/send`,
    headers: { cookie },
    query: { token },
    body: {
      recipientEmail,
    },
  });
  const res = createMockRes();
  await sharedReportSendHandler(req, res, token);
  return { status: res.statusCode, body: res.jsonBody() };
}

async function archiveProposalViaApi(cookie, proposalId) {
  const req = createMockReq({
    method: 'PATCH',
    url: `/api/proposals/${proposalId}/archive`,
    headers: { cookie },
    query: { id: proposalId },
  });
  const res = createMockRes();
  await proposalArchiveHandler(req, res, proposalId);
  return { status: res.statusCode, body: res.jsonBody() };
}

async function deleteProposalViaApi(cookie, proposalId) {
  const req = createMockReq({
    method: 'DELETE',
    url: `/api/proposals/${proposalId}`,
    headers: { cookie },
    query: { id: proposalId },
  });
  const res = createMockRes();
  await proposalDetailHandler(req, res, proposalId);
  return { status: res.statusCode, body: res.jsonBody() };
}

function stubResendEmail() {
  const original = {
    EMAIL_MODE: process.env.EMAIL_MODE,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
    fetch: globalThis.fetch,
  };
  const sent = [];
  process.env.EMAIL_MODE = 'transactional';
  process.env.RESEND_API_KEY = 'test-key-starter-limits';
  process.env.RESEND_FROM_EMAIL = 'test@mail.getpremarket.com';
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('api.resend.com/emails')) {
      const payload = JSON.parse(String(init.body || '{}'));
      sent.push(payload);
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: `msg_${sent.length}` }),
      };
    }
    return original.fetch(url, init);
  };
  return {
    sent,
    restore() {
      globalThis.fetch = original.fetch;
      for (const [key, value] of Object.entries(original)) {
        if (key === 'fetch') continue;
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}

function startOfPreviousUtcMonth() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0, 0));
}

serialTest('AI mediation review credit limits are configured by plan tier', () => {
  assert.equal(getAiMediationReviewLimitForPlan('starter'), 3);
  assert.equal(getAiMediationReviewLimitForPlan('free'), 3);
  assert.equal(getAiMediationReviewLimitForPlan('professional'), 20);
  assert.equal(getAiMediationReviewLimitForPlan('early_access'), 20);
  assert.equal(getAiMediationReviewLimitForPlan('early_access_program'), 20);
  assert.equal(getAiMediationReviewLimitForPlan('team'), 100);
  assert.equal(getAiMediationReviewLimitForPlan('enterprise'), null);
  assert.equal(getAiMediationReviewLimitForPlan('custom'), 3);
  assert.equal(getAiMediationReviewLimitForPlan(''), 3);
});

if (!hasDatabaseUrl()) {
  test('starter limits integration (skipped: DATABASE_URL missing)', { skip: true }, () => {});
} else {
  test('Starter creation limit: /api/proposals blocks after 1 opportunity/month', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'starter_create_monthly';
    const email = 'starter.monthly@example.com';
    const cookie = authCookie(userId, email);
    await seedUserAndPlan(userId, email, 'starter');

    await seedProposal(userId, 'p1');

    const result = await createProposalViaApi(cookie, 'blocked p2');
    assert.equal(result.status, 429);
    assert.equal(result.body?.error?.code, 'starter_opportunities_monthly_limit_reached');
  });

  test('Starter monthly quota cannot be bypassed by archiving the first opportunity', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'starter_archive_monthly_block';
    const email = 'starter.archive.monthly@example.com';
    const cookie = authCookie(userId, email);
    await seedUserAndPlan(userId, email, 'starter');

    const created = await createProposalViaApi(cookie, 'first opportunity');
    assert.equal(created.status, 201);

    const proposalId = created.body?.proposal?.id;
    assert.ok(proposalId);

    const archived = await archiveProposalViaApi(cookie, proposalId);
    assert.equal(archived.status, 200);
    assert.ok(archived.body?.proposal?.archived_at);

    const blocked = await createProposalViaApi(cookie, 'second opportunity');
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body?.error?.code, 'starter_opportunities_monthly_limit_reached');
    assert.equal(blocked.body?.error?.used, 1);
  });

  test('Starter monthly quota cannot be bypassed by deleting a draft after creation', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'starter_delete_monthly_block';
    const email = 'starter.delete.monthly@example.com';
    const cookie = authCookie(userId, email);
    await seedUserAndPlan(userId, email, 'starter');

    const created = await createProposalViaApi(cookie, 'deletable draft');
    assert.equal(created.status, 201);

    const proposalId = created.body?.proposal?.id;
    assert.ok(proposalId);

    const deleted = await deleteProposalViaApi(cookie, proposalId);
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body?.deleted, true);

    const blocked = await createProposalViaApi(cookie, 'blocked after delete');
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body?.error?.code, 'starter_opportunities_monthly_limit_reached');
    assert.equal(blocked.body?.error?.used, 1);
  });

  test('Starter cannot bypass monthly quota via owner send-fork', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'starter_send_fork_monthly_block';
    const email = 'starter.send.fork.monthly@example.com';
    const cookie = authCookie(userId, email);
    await seedUserAndPlan(userId, email, 'starter');

    const stub = stubResendEmail();
    try {
      const created = await createProposalViaApi(cookie, 'starter send-fork monthly');
      assert.equal(created.status, 201);
      const proposalId = created.body?.proposal?.id;
      assert.ok(proposalId);

      const firstSend = await sendProposalViaApi(cookie, proposalId, 'alice@example.com');
      assert.equal(firstSend.status, 200);

      const blocked = await sendProposalViaApi(cookie, proposalId, 'bob@example.com');
      assert.equal(blocked.status, 429);
      assert.equal(blocked.body?.error?.code, 'starter_opportunities_monthly_limit_reached');

      const db = await getDb();
      const proposals = await db
        .select({
          id: schema.proposals.id,
          sourceProposalId: schema.proposals.sourceProposalId,
        })
        .from(schema.proposals)
        .where(eq(schema.proposals.userId, userId));

      assert.equal(proposals.length, 1);
      assert.equal(
        proposals.some((row) => row.sourceProposalId === proposalId),
        false,
      );
      assert.equal(stub.sent.length, 1, 'blocked fork should not send a second email');
    } finally {
      stub.restore();
    }
  });

  test('Starter cannot bypass active quota via owner send-fork', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'starter_send_fork_active_block';
    const email = 'starter.send.fork.active@example.com';
    const cookie = authCookie(userId, email);
    await seedUserAndPlan(userId, email, 'starter');

    const previousMonth = startOfPreviousUtcMonth();
    const proposalId = 'starter_send_fork_active_source';
    await seedProposal(userId, 'starter active send-fork source', {
      id: proposalId,
      status: 'sent',
      partyAEmail: email,
      partyBEmail: 'alice@example.com',
      sentAt: previousMonth,
      createdAt: previousMonth,
      updatedAt: previousMonth,
    });

    const stub = stubResendEmail();
    try {
      const blocked = await sendProposalViaApi(cookie, proposalId, 'bob@example.com');
      assert.equal(blocked.status, 429);
      assert.equal(blocked.body?.error?.code, 'starter_active_opportunities_limit_reached');

      const db = await getDb();
      const proposals = await db
        .select({
          id: schema.proposals.id,
          sourceProposalId: schema.proposals.sourceProposalId,
        })
        .from(schema.proposals)
        .where(eq(schema.proposals.userId, userId));

      assert.equal(proposals.length, 1);
      assert.equal(
        proposals.some((row) => row.sourceProposalId === proposalId),
        false,
      );
      assert.equal(stub.sent.length, 0, 'blocked active fork should fail before email send');
    } finally {
      stub.restore();
    }
  });

  test('Starter cannot bypass monthly quota via shared-report send-fork', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'starter_shared_report_fork_monthly_block';
    const email = 'starter.shared.report.fork.monthly@example.com';
    const cookie = authCookie(userId, email);
    await seedUserAndPlan(userId, email, 'starter');

    const stub = stubResendEmail();
    try {
      const comparisonResult = await createComparisonViaApi(cookie, {
        title: 'starter shared-report send-fork monthly',
      });
      assert.equal(comparisonResult.status, 201);
      const comparison = comparisonResult.body?.comparison;
      const proposalId = comparison?.proposal_id;
      assert.ok(proposalId);

      const sharedReportResult = await createSharedReportLinkViaApi(cookie, comparison.id, 'alice@example.com');
      assert.equal(sharedReportResult.status, 201);
      const token = sharedReportResult.body?.sharedReport?.token || sharedReportResult.body?.token;
      assert.ok(token);

      const db = await getDb();
      const sentAt = new Date();
      await db
        .update(schema.proposals)
        .set({
          status: 'sent',
          sentAt,
          partyBEmail: 'alice@example.com',
          updatedAt: sentAt,
        })
        .where(eq(schema.proposals.id, proposalId));

      const blocked = await sendSharedReportViaApi(cookie, token, 'bob@example.com');
      assert.equal(blocked.status, 429);
      assert.equal(blocked.body?.error?.code, 'starter_opportunities_monthly_limit_reached');

      const forked = await db
        .select({ id: schema.proposals.id })
        .from(schema.proposals)
        .where(eq(schema.proposals.sourceProposalId, proposalId));
      assert.equal(forked.length, 0);
      assert.equal(stub.sent.length, 0, 'blocked shared-report fork should fail before email send');
    } finally {
      stub.restore();
    }
  });

  test('Starter creation limit: template-use route is also blocked', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'starter_template_block';
    const email = 'starter.template@example.com';
    const cookie = authCookie(userId, email);
    await seedUserAndPlan(userId, email, 'starter');

    const db = await getDb();
    await db.insert(schema.templates).values({
      id: 'template_starter_limit_test',
      userId,
      name: 'Starter Template',
      slug: 'starter-template-test',
      description: 'Starter template for limits test',
      category: 'custom',
      status: 'active',
      metadata: { template_key: 'starter_template_key' },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await seedProposal(userId, 'p1');

    const req = createMockReq({
      method: 'POST',
      url: '/api/templates/template_starter_limit_test/use',
      headers: { cookie },
      query: { id: 'template_starter_limit_test' },
      body: {
        title: 'from template',
      },
    });
    const res = createMockRes();
    await templateUseHandler(req, res, 'template_starter_limit_test');

    assert.equal(res.statusCode, 429);
    assert.equal(res.jsonBody()?.error?.code, 'starter_opportunities_monthly_limit_reached');
  });

  test('Starter active limit: /api/proposals blocks when 1 active opportunity already exists', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'starter_active_limit';
    const email = 'starter.active@example.com';
    const cookie = authCookie(userId, email);
    await seedUserAndPlan(userId, email, 'starter');

    const previousMonth = startOfPreviousUtcMonth();
    await seedProposal(userId, 'active1', {
      status: 'draft',
      createdAt: previousMonth,
      updatedAt: previousMonth,
    });

    const result = await createProposalViaApi(cookie, 'blocked active 2nd');
    assert.equal(result.status, 429);
    assert.equal(result.body?.error?.code, 'starter_active_opportunities_limit_reached');
  });

  test('Starter active quota cannot be bypassed by archiving an open opportunity', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'starter_archive_active_block';
    const email = 'starter.archive.active@example.com';
    const cookie = authCookie(userId, email);
    await seedUserAndPlan(userId, email, 'starter');

    const previousMonth = startOfPreviousUtcMonth();
    await seedProposal(userId, 'active-archive-target', {
      id: 'starter_archive_active_target',
      status: 'draft',
      createdAt: previousMonth,
      updatedAt: previousMonth,
    });

    const archived = await archiveProposalViaApi(cookie, 'starter_archive_active_target');
    assert.equal(archived.status, 200);
    assert.ok(archived.body?.proposal?.archived_at);

    const blocked = await createProposalViaApi(cookie, 'blocked after archive');
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body?.error?.code, 'starter_active_opportunities_limit_reached');
    assert.equal(blocked.body?.error?.used, 1);
  });

  test('Archived open opportunity still counts as active in starter usage snapshots', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'starter_archive_snapshot_count';
    const email = 'starter.archive.snapshot@example.com';
    const cookie = authCookie(userId, email);
    await seedUserAndPlan(userId, email, 'starter');

    const previousMonth = startOfPreviousUtcMonth();
    await seedProposal(userId, 'snapshot archived active', {
      id: 'starter_archive_snapshot_target',
      status: 'draft',
      createdAt: previousMonth,
      updatedAt: previousMonth,
    });

    const archived = await archiveProposalViaApi(cookie, 'starter_archive_snapshot_target');
    assert.equal(archived.status, 200);

    const db = await getDb();
    const snapshot = await getStarterUsageSnapshot(db, {
      userId,
      userEmail: email,
    });

    assert.equal(snapshot?.usage?.activeOpportunities, 1);
    assert.equal(snapshot?.remaining?.activeOpportunities, 0);
  });

  test('Starter active quota still applies after soft-deleting an open sent opportunity', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'starter_delete_active_block';
    const email = 'starter.delete.active@example.com';
    const cookie = authCookie(userId, email);
    await seedUserAndPlan(userId, email, 'starter');

    const previousMonth = startOfPreviousUtcMonth();
    await seedProposal(userId, 'soft-delete target', {
      id: 'starter_delete_active_target',
      status: 'sent',
      partyAEmail: email,
      partyBEmail: 'recipient@example.com',
      sentAt: previousMonth,
      createdAt: previousMonth,
      updatedAt: previousMonth,
    });

    const deleted = await deleteProposalViaApi(cookie, 'starter_delete_active_target');
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body?.deleted, true);
    assert.equal(deleted.body?.mode, 'soft');

    const blocked = await createProposalViaApi(cookie, 'blocked after soft delete');
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body?.error?.code, 'starter_active_opportunities_limit_reached');
    assert.equal(blocked.body?.error?.used, 1);
  });

  test('Starter review limit: /api/proposals/[id]/evaluate blocks after 3/month', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'starter_eval_limit';
    const email = 'starter.eval@example.com';
    const cookie = authCookie(userId, email);
    await seedUserAndPlan(userId, email, 'starter');

    const db = await getDb();
    await seedProposal(userId, 'Evaluate Me', {
      id: 'proposal_eval_limit_target',
      partyAEmail: email,
      partyBEmail: 'recipient@example.com',
    });

    const now = new Date();
    for (let i = 0; i < 3; i += 1) {
      await db.insert(schema.proposalEvaluations).values({
        id: `eval_limit_${i}`,
        proposalId: 'proposal_eval_limit_target',
        userId,
        source: 'document_comparison_mediation',
        status: 'completed',
        score: 60,
        summary: 'seed',
        result: {},
        createdAt: now,
        updatedAt: now,
      });
    }

    const req = createMockReq({
      method: 'POST',
      url: '/api/proposals/proposal_eval_limit_target/evaluate',
      headers: { cookie },
      query: { id: 'proposal_eval_limit_target' },
      body: {},
    });
    const res = createMockRes();
    await proposalEvaluateHandler(req, res, 'proposal_eval_limit_target');

    assert.equal(res.statusCode, 429);
    assert.equal(res.jsonBody()?.error?.code, 'starter_ai_evaluations_monthly_limit_reached');
  });

  test('Professional review credits block after 20 AI mediation reviews/month', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'professional_review_limit';
    const email = 'professional.review.limit@example.com';
    await seedUserAndPlan(userId, email, 'professional');

    await seedProposal(userId, 'Professional Review Limit', {
      id: 'proposal_professional_review_limit',
      partyAEmail: email,
      partyBEmail: 'recipient@example.com',
    });

    const db = await getDb();
    const now = new Date();
    for (let i = 0; i < 20; i += 1) {
      await db.insert(schema.proposalEvaluations).values({
        id: `professional_review_limit_${i}`,
        proposalId: 'proposal_professional_review_limit',
        userId,
        source: 'document_comparison_mediation',
        status: 'completed',
        score: 60,
        summary: 'seed',
        result: {},
        createdAt: now,
        updatedAt: now,
      });
    }

    await assert.rejects(
      assertStarterAiEvaluationAllowed(db, {
        userId,
        userEmail: email,
      }),
      (error) =>
        error?.code === 'ai_mediation_reviews_monthly_limit_reached' &&
        error?.extra?.plan === 'professional' &&
        error?.extra?.limit === 20,
    );
  });

  test('Starter upload limits: per-opportunity cap blocks large document comparison attachments', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'starter_upload_opportunity_limit';
    const email = 'starter.upload.opportunity@example.com';
    const cookie = authCookie(userId, email);
    await seedUserAndPlan(userId, email, 'starter');

    const req = createMockReq({
      method: 'POST',
      url: '/api/document-comparisons',
      headers: { cookie },
      body: {
        title: 'Upload Heavy Comparison',
        create_proposal: true,
        doc_a_files: [{ filename: 'a.pdf', sizeBytes: 20 * MB }],
        doc_b_files: [{ filename: 'b.pdf', sizeBytes: 7 * MB }],
      },
    });
    const res = createMockRes();
    await documentComparisonsHandler(req, res);

    assert.equal(res.statusCode, 429);
    assert.equal(res.jsonBody()?.error?.code, 'starter_upload_per_opportunity_limit_exceeded');
  });

  test('Starter upload limits: monthly cap blocks /api/documents/extract', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'starter_upload_monthly_limit';
    const email = 'starter.upload.monthly@example.com';
    const cookie = authCookie(userId, email);
    await seedUserAndPlan(userId, email, 'starter');

    const db = await getDb();
    await db.insert(schema.starterUsageEvents).values({
      id: 'usage_seed_monthly_1',
      userId,
      eventType: 'upload_bytes',
      quantity: 100 * MB,
      scopeId: null,
      metadata: { source: 'seed' },
      createdAt: new Date(),
    });

    const req = createMockReq({
      method: 'POST',
      url: '/api/documents/extract',
      headers: { cookie },
      body: {
        filename: 'tiny.pdf',
        mimeType: 'application/pdf',
        fileBase64: Buffer.from('hello').toString('base64'),
      },
    });
    const res = createMockRes();
    await documentsExtractHandler(req, res);

    assert.equal(res.statusCode, 429);
    assert.equal(res.jsonBody()?.error?.code, 'starter_upload_monthly_limit_exceeded');
  });

  test('Paid plans are unaffected by starter creation caps', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'pro_unaffected_creation';
    const email = 'pro.unaffected@example.com';
    const cookie = authCookie(userId, email);
    await seedUserAndPlan(userId, email, 'professional');

    await seedProposal(userId, 'p1');
    await seedProposal(userId, 'p2');
    await seedProposal(userId, 'p3');

    const result = await createProposalViaApi(cookie, 'pro p4 allowed');
    assert.equal(result.status, 201, `Expected paid plan to create successfully: ${JSON.stringify(result.body)}`);
    assert.equal(result.body?.ok, true);
  });

  test('paid/manual plan variants are never treated as starter for creation caps', async () => {
    await ensureMigrated();
    await resetTables();

    const nonStarterPlans = ['professional', 'team', 'enterprise'];

    for (const [index, plan] of nonStarterPlans.entries()) {
      const userId = `nonstarter_create_${index}`;
      const email = `nonstarter-create-${index}@example.com`;
      const cookie = authCookie(userId, email);
      await seedUserAndPlan(userId, email, plan);

      await seedProposal(userId, `${plan}-p1`);
      await seedProposal(userId, `${plan}-p2`);
      await seedProposal(userId, `${plan}-p3`);

      const result = await createProposalViaApi(cookie, `${plan}-p4-allowed`);
      assert.equal(
        result.status,
        201,
        `Expected paid/manual plan "${plan}" to bypass starter caps: ${JSON.stringify(result.body)}`,
      );
      assert.equal(result.body?.ok, true);
    }
  });

  test('Early Access user with no billing row is NOT subject to proposal creation caps', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'early_access_no_billing_create';
    const email = 'early-access-no-billing@example.com';
    const cookie = authCookie(userId, email);

    // Seed the user with NO billing row - only an active betaSignups trial.
    const db = await getDb();
    await db
      .insert(schema.users)
      .values({ id: userId, email })
      .onConflictDoNothing({ target: schema.users.id });

    await db
      .insert(schema.betaSignups)
      .values({
        id: randomUUID(),
        email,
        emailNormalized: email.toLowerCase(),
        userId,
        source: 'pricing',
        trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        createdAt: new Date(),
      })
      .onConflictDoNothing({ target: schema.betaSignups.emailNormalized });

    // Seed 3 proposals (≥ starter monthly limit)
    await seedProposal(userId, 'ea-nobilling-p1');
    await seedProposal(userId, 'ea-nobilling-p2');
    await seedProposal(userId, 'ea-nobilling-p3');

    // 4th proposal must succeed – early access is not capped
    const result = await createProposalViaApi(cookie, 'ea-nobilling-p4-should-pass');
    assert.equal(
      result.status,
      201,
      `Early Access user with no billing row must not be starter-capped: ${JSON.stringify(result.body)}`,
    );
    assert.equal(result.body?.ok, true);
  });

  test('Early Access user with default starter billing row AND betaSignup is NOT capped (regression)', async () => {
    await ensureMigrated();
    await resetTables();

    // This is the exact bug scenario: billing_references.plan = 'starter' (the
    // DB default) exists, but the user is also in betaSignups → Early Access.
    // They must NOT be subject to any Starter limits.
    const userId = 'ea_default_starter_billing';
    const email = 'ea-default-starter-billing@example.com';
    const cookie = authCookie(userId, email);

    const db = await getDb();
    await db
      .insert(schema.users)
      .values({ id: userId, email })
      .onConflictDoNothing({ target: schema.users.id });

    // Billing row with the DEFAULT plan value of 'starter'
    await db
      .insert(schema.billingReferences)
      .values({ userId, plan: 'starter', status: 'inactive', updatedAt: new Date() })
      .onConflictDoUpdate({
        target: schema.billingReferences.userId,
        set: { plan: 'starter', status: 'inactive', updatedAt: new Date() },
      });

    // Active betaSignups trial — the user IS in Early Access
    await db
      .insert(schema.betaSignups)
      .values({
        id: randomUUID(),
        email,
        emailNormalized: email.toLowerCase(),
        userId,
        source: 'pricing',
        trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        createdAt: new Date(),
      })
      .onConflictDoNothing({ target: schema.betaSignups.emailNormalized });

    await seedProposal(userId, 'ea-default-p1');
    await seedProposal(userId, 'ea-default-p2');
    await seedProposal(userId, 'ea-default-p3');

    const result = await createProposalViaApi(cookie, 'ea-default-p4-must-pass');
    assert.equal(
      result.status,
      201,
      `Early Access user with default starter billing row must not be capped: ${JSON.stringify(result.body)}`,
    );
    assert.equal(result.body?.ok, true);
  });

  test('Early Access billing aliases without active beta trial fail closed to Starter', async () => {
    await ensureMigrated();
    await resetTables();

    const earlyAccessVariants = [
      'early_access',
      'early-access',
      'early access',
      'early_access_program',
      'early-access-program',
      'early access program',
    ];

    for (const [index, plan] of earlyAccessVariants.entries()) {
      const uid = `ea_billing_create_${index}`;
      const em = `ea-billing-create-${index}@example.com`;
      await seedUserAndPlan(uid, em, plan);
      await seedProposal(uid, `${plan}-p1`);

      const result = await createProposalViaApi(authCookie(uid, em), `${plan}-p2-should-block`);
      assert.equal(
        result.status,
        429,
        `Early Access billing alias "${plan}" must not bypass starter caps without an active beta trial: ${JSON.stringify(result.body)}`,
      );
      assert.equal(result.body?.error?.code, 'starter_opportunities_monthly_limit_reached');
    }
  });

  test('Starter review pool ignores failed attempts and failed shared-report runs', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'starter_eval_failed_ignored';
    const email = 'starter.eval.failed@example.com';
    await seedUserAndPlan(userId, email, 'starter');
    await seedProposal(userId, 'Starter Eval Pool', {
      id: 'proposal_eval_failed_ignored',
      partyAEmail: email,
      partyBEmail: 'recipient@example.com',
    });

    const db = await getDb();
    const now = new Date();
    for (let i = 0; i < 10; i += 1) {
      await db.insert(schema.proposalEvaluations).values({
        id: `eval_failed_${i}`,
        proposalId: 'proposal_eval_failed_ignored',
        userId,
        source: 'document_comparison_mediation',
        status: 'failed',
        score: null,
        summary: 'failed',
        result: {},
        createdAt: now,
        updatedAt: now,
      });
    }

    await db.insert(schema.sharedLinks).values({
      id: 'shared_link_eval_failed_ignored',
      token: 'token_eval_failed_ignored',
      userId,
      proposalId: 'proposal_eval_failed_ignored',
      recipientEmail: email,
      authorizedUserId: userId,
      canView: true,
      canEdit: true,
      canReevaluate: true,
      maxUses: 5,
      uses: 0,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.sharedReportRecipientRevisions).values({
      id: 'share_rev_eval_failed_ignored',
      sharedLinkId: 'shared_link_eval_failed_ignored',
      proposalId: 'proposal_eval_failed_ignored',
      comparisonId: null,
      actorRole: 'recipient',
      status: 'draft',
      workflowStep: 2,
      sharedPayload: {},
      recipientConfidentialPayload: {},
      editorState: {},
      previousRevisionId: null,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.sharedReportEvaluationRuns).values({
      id: 'share_eval_failed_ignored',
      sharedLinkId: 'shared_link_eval_failed_ignored',
      proposalId: 'proposal_eval_failed_ignored',
      comparisonId: null,
      revisionId: 'share_rev_eval_failed_ignored',
      actorRole: 'recipient',
      status: 'error',
      resultPublicReport: {},
      resultJson: {},
      errorCode: 'evaluation_failed',
      errorMessage: 'failed',
      createdAt: now,
      updatedAt: now,
    });

    await assert.doesNotReject(
      assertStarterAiEvaluationAllowed(db, {
        userId,
        userEmail: email,
      }),
    );
  });

  test('Starter shared-report reviews count against the same monthly owner pool', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'starter_eval_shared_pool';
    const email = 'starter.eval.shared.pool@example.com';
    const recipientUserId = 'starter_eval_shared_pool_recipient';
    const recipientEmail = 'starter.eval.shared.pool.recipient@example.com';
    await seedUserAndPlan(userId, email, 'starter');
    await seedUserAndPlan(recipientUserId, recipientEmail, 'starter');
    await seedProposal(userId, 'Shared Eval Pool', {
      id: 'proposal_eval_shared_pool',
      partyAEmail: email,
      partyBEmail: recipientEmail,
    });

    const db = await getDb();
    const now = new Date();
    for (let i = 0; i < 2; i += 1) {
      await db.insert(schema.proposalEvaluations).values({
        id: `eval_shared_pool_${i}`,
        proposalId: 'proposal_eval_shared_pool',
        userId,
        source: 'document_comparison_mediation',
        status: 'completed',
        score: 70,
        summary: 'ok',
        result: {},
        createdAt: now,
        updatedAt: now,
      });
    }

    await db.insert(schema.sharedLinks).values({
      id: 'shared_link_eval_shared_pool',
      token: 'token_eval_shared_pool',
      userId,
      proposalId: 'proposal_eval_shared_pool',
      recipientEmail,
      authorizedUserId: recipientUserId,
      canView: true,
      canEdit: true,
      canReevaluate: true,
      maxUses: 5,
      uses: 0,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.sharedReportRecipientRevisions).values({
      id: 'share_rev_eval_shared_pool',
      sharedLinkId: 'shared_link_eval_shared_pool',
      proposalId: 'proposal_eval_shared_pool',
      comparisonId: null,
      actorRole: 'recipient',
      status: 'draft',
      workflowStep: 2,
      sharedPayload: {},
      recipientConfidentialPayload: {},
      editorState: {},
      previousRevisionId: null,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.sharedReportEvaluationRuns).values({
      id: 'share_eval_shared_pool',
      sharedLinkId: 'shared_link_eval_shared_pool',
      proposalId: 'proposal_eval_shared_pool',
      comparisonId: null,
      revisionId: 'share_rev_eval_shared_pool',
      actorRole: 'recipient',
      status: 'success',
      resultPublicReport: {},
      resultJson: {},
      errorCode: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    });

    await assert.rejects(
      assertStarterAiEvaluationAllowed(db, {
        userId,
        userEmail: email,
      }),
      (error) => error?.code === 'starter_ai_evaluations_monthly_limit_reached',
    );

    await assert.doesNotReject(
      assertStarterAiEvaluationAllowed(db, {
        userId: recipientUserId,
        userEmail: recipientEmail,
      }),
    );
  });

  test('Review-credit reservations block concurrent monthly overshoot but release cleanly', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'starter_review_reservation';
    const email = 'starter.review.reservation@example.com';
    await seedUserAndPlan(userId, email, 'starter');
    await seedProposal(userId, 'Starter Review Reservation', {
      id: 'proposal_review_reservation',
      partyAEmail: email,
      partyBEmail: 'recipient@example.com',
    });

    const db = await getDb();
    const now = new Date();
    for (let i = 0; i < 2; i += 1) {
      await db.insert(schema.proposalEvaluations).values({
        id: `review_reservation_used_${i}`,
        proposalId: 'proposal_review_reservation',
        userId,
        source: 'document_comparison_mediation',
        status: 'completed',
        score: 70,
        summary: 'ok',
        result: {},
        createdAt: now,
        updatedAt: now,
      });
    }

    const reservationId = await reserveAiMediationReviewCredit(db, {
      userId,
      userEmail: email,
      source: 'test_concurrent_review',
      scopeId: 'proposal_review_reservation',
      now,
    });

    await assert.rejects(
      assertStarterAiEvaluationAllowed(db, {
        userId,
        userEmail: email,
        now,
      }),
      (error) =>
        error?.code === 'starter_ai_evaluations_monthly_limit_reached' &&
        error?.extra?.used === 2 &&
        error?.extra?.reserved === 1,
    );

    await releaseAiMediationReviewReservation(db, reservationId);

    await assert.doesNotReject(
      assertStarterAiEvaluationAllowed(db, {
        userId,
        userEmail: email,
        now,
      }),
    );
  });

  test('AI assistance quota blocks authenticated cache-miss assistance without using review credits', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'starter_ai_assistance_quota';
    const email = 'starter.ai.assistance@example.com';
    await seedUserAndPlan(userId, email, 'starter');

    const db = await getDb();
    const now = new Date();
    for (let i = 0; i < 20; i += 1) {
      await recordAiAssistanceUsage(db, {
        userId,
        actorRole: 'owner',
        action: 'draft_response',
        scopeId: `comparison_${i}`,
        comparisonId: `comparison_${i}`,
        now,
      });
    }

    await assert.rejects(
      assertAiAssistanceAllowed(db, {
        userId,
        actorRole: 'owner',
        action: 'draft_response',
        scopeId: 'comparison_next',
        now,
      }),
      (error) =>
        error?.code === 'ai_assistance_monthly_limit_reached' &&
        error?.extra?.limit === 20 &&
        error?.extra?.used === 20,
    );

    await assert.doesNotReject(
      assertStarterAiEvaluationAllowed(db, {
        userId,
        userEmail: email,
        now,
      }),
    );
  });

  test('Shared-recipient AI assistance and Company Context are scoped per shared link', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'starter_shared_ai_assistance';
    const email = 'starter.shared.ai.assistance@example.com';
    await seedUserAndPlan(userId, email, 'professional');

    const db = await getDb();
    const now = new Date();
    const checkNow = new Date(now.getTime() + 1000);
    await recordAiAssistanceUsage(db, {
      userId,
      actorRole: 'recipient',
      action: 'company_brief',
      scopeId: 'shared_link_company_context',
      sharedLinkId: 'shared_link_company_context',
      now,
    });

    await assert.rejects(
      assertAiAssistanceAllowed(db, {
        userId,
        actorRole: 'recipient',
        action: 'company_brief',
        scopeId: 'shared_link_company_context',
        now: checkNow,
      }),
      (error) =>
        error?.code === 'company_context_daily_limit_reached' &&
        error?.extra?.limit === 1 &&
        error?.message ===
          'Company Context has already been generated for this shared opportunity today. You can still use the other suggestion tools or write your response manually.',
    );

    await assert.doesNotReject(
      assertAiAssistanceAllowed(db, {
        userId,
        actorRole: 'recipient',
        action: 'draft_response',
        scopeId: 'shared_link_company_context',
        now: checkNow,
      }),
    );

    for (let i = 1; i < 5; i += 1) {
      await recordAiAssistanceUsage(db, {
        userId,
        actorRole: 'recipient',
        action: 'draft_response',
        scopeId: 'shared_link_company_context',
        sharedLinkId: 'shared_link_company_context',
        now,
      });
    }

    await assert.rejects(
      assertAiAssistanceAllowed(db, {
        userId,
        actorRole: 'recipient',
        action: 'draft_response',
        scopeId: 'shared_link_company_context',
        now: checkNow,
      }),
      (error) =>
        error?.code === 'ai_assistance_shared_link_limit_reached' &&
        error?.extra?.limit === 5 &&
        error?.message ===
          'You’ve reached the daily AI suggestion limit for this shared opportunity. You can still write and send your response.',
    );
  });

  test('Starter monthly opportunity counter resets on calendar month boundaries', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'starter_month_boundary_create';
    const email = 'starter.month.boundary.create@example.com';
    const cookie = authCookie(userId, email);
    await seedUserAndPlan(userId, email, 'starter');

    const previousMonth = startOfPreviousUtcMonth();
    await seedProposal(userId, 'old-p1', {
      createdAt: previousMonth,
      updatedAt: previousMonth,
      status: 'won',
      partyAOutcome: 'won',
      partyBOutcome: 'won',
    });
    await seedProposal(userId, 'old-p2', {
      createdAt: previousMonth,
      updatedAt: previousMonth,
      status: 'won',
      partyAOutcome: 'won',
      partyBOutcome: 'won',
    });
    await seedProposal(userId, 'old-p3', {
      createdAt: previousMonth,
      updatedAt: previousMonth,
      status: 'won',
      partyAOutcome: 'won',
      partyBOutcome: 'won',
    });

    const result = await createProposalViaApi(cookie, 'new-month-allowed');
    assert.equal(result.status, 201);
  });

  test('Starter monthly upload counter resets on calendar month boundaries', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'starter_month_boundary_upload';
    const email = 'starter.month.boundary.upload@example.com';
    const cookie = authCookie(userId, email);
    await seedUserAndPlan(userId, email, 'starter');

    const db = await getDb();
    await db.insert(schema.starterUsageEvents).values({
      id: 'usage_prev_month_upload',
      userId,
      eventType: 'upload_bytes',
      quantity: 100 * MB,
      scopeId: null,
      metadata: { source: 'seed_prev_month' },
      createdAt: startOfPreviousUtcMonth(),
    });

    const payload = Buffer.from('new month upload').toString('base64');
    const req = createMockReq({
      method: 'POST',
      url: '/api/documents/upload',
      headers: { cookie },
      body: {
        filename: 'notes.txt',
        mimeType: 'text/plain',
        fileBase64: payload,
      },
    });
    const res = createMockRes();
    await documentsHandler(req, res);

    assert.equal(res.statusCode, 201);
  });

  test('Starter template-create flow enforces active cap with same structured error shape', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'starter_template_active_limit';
    const email = 'starter.template.active@example.com';
    const cookie = authCookie(userId, email);
    await seedUserAndPlan(userId, email, 'starter');

    const db = await getDb();
    await db.insert(schema.templates).values({
      id: 'template_starter_active_test',
      userId,
      name: 'Starter Active Template',
      slug: 'starter-active-template-test',
      description: 'Starter active cap template test',
      category: 'custom',
      status: 'active',
      metadata: { template_key: 'starter_active_template_key' },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const previousMonth = startOfPreviousUtcMonth();
    await seedProposal(userId, 'active-template-1', {
      status: 'draft',
      createdAt: previousMonth,
      updatedAt: previousMonth,
    });

    const req = createMockReq({
      method: 'POST',
      url: '/api/templates/template_starter_active_test/use',
      headers: { cookie },
      query: { id: 'template_starter_active_test' },
      body: {
        title: 'from template active blocked',
      },
    });
    const res = createMockRes();
    await templateUseHandler(req, res, 'template_starter_active_test');

    assert.equal(res.statusCode, 429);
    const body = res.jsonBody();
    assert.equal(body?.error?.code, 'starter_active_opportunities_limit_reached');
    assert.equal(body?.error?.plan, 'starter');
    assert.equal(body?.error?.limit, 1);
    assert.equal(body?.error?.used, 1);
  });

  test('Template-created proposals write durable proposal.created history that survives hard delete', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'starter_template_created_history';
    const email = 'starter.template.created.history@example.com';
    const cookie = authCookie(userId, email);
    await seedUserAndPlan(userId, email, 'starter');

    const db = await getDb();
    await db.insert(schema.templates).values({
      id: 'template_starter_created_history',
      userId,
      name: 'Starter Durable History Template',
      slug: 'starter-durable-history-template',
      description: 'Starter durable history template test',
      category: 'custom',
      status: 'active',
      metadata: { template_key: 'starter_created_history_template_key' },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const created = await useTemplateViaApi(cookie, 'template_starter_created_history', {
      title: 'starter durable template proposal',
    });
    assert.equal(created.status, 201);
    const proposalId = created.body?.proposal?.id;
    assert.ok(proposalId);

    const history = await db
      .select({ eventType: schema.proposalEvents.eventType })
      .from(schema.proposalEvents)
      .where(eq(schema.proposalEvents.proposalId, proposalId));
    assert.equal(
      history.some((row) => row.eventType === 'proposal.created'),
      true,
    );

    const deleted = await deleteProposalViaApi(cookie, proposalId);
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body?.mode, 'hard');

    const blocked = await useTemplateViaApi(cookie, 'template_starter_created_history', {
      title: 'starter durable template proposal retry',
    });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body?.error?.code, 'starter_opportunities_monthly_limit_reached');
  });

  test('Document-comparison-created proposals write durable proposal.created history that survives hard delete', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'starter_document_comparison_created_history';
    const email = 'starter.document.comparison.created.history@example.com';
    const cookie = authCookie(userId, email);
    await seedUserAndPlan(userId, email, 'starter');

    const created = await createComparisonViaApi(cookie, {
      title: 'starter durable document comparison proposal',
    });
    assert.equal(created.status, 201);
    const comparison = created.body?.comparison;
    const proposalId = comparison?.proposal_id;
    assert.ok(proposalId);

    const db = await getDb();
    const history = await db
      .select({ eventType: schema.proposalEvents.eventType })
      .from(schema.proposalEvents)
      .where(eq(schema.proposalEvents.proposalId, proposalId));
    assert.equal(
      history.some((row) => row.eventType === 'proposal.created'),
      true,
    );

    const deleted = await deleteProposalViaApi(cookie, proposalId);
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body?.mode, 'hard');

    const blocked = await createComparisonViaApi(cookie, {
      title: 'starter durable document comparison proposal retry',
    });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body?.error?.code, 'starter_opportunities_monthly_limit_reached');
  });

  test('Starter active capacity is released after a terminal lost outcome', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'starter_active_release';
    const email = 'starter.active.release@example.com';
    const cookie = authCookie(userId, email);
    await seedUserAndPlan(userId, email, 'starter');

    const previousMonth = startOfPreviousUtcMonth();
    await seedProposal(userId, 'active-release-1', {
      id: 'active_release_p1',
      status: 'draft',
      createdAt: previousMonth,
      updatedAt: previousMonth,
    });

    const blocked = await createProposalViaApi(cookie, 'blocked-before-release');
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body?.error?.code, 'starter_active_opportunities_limit_reached');

    const db = await getDb();
    await db
      .update(schema.proposals)
      .set({
        status: 'lost',
        partyAOutcome: 'lost',
        partyAOutcomeAt: new Date(),
        closedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.proposals.id, 'active_release_p1'));

    const allowed = await createProposalViaApi(cookie, 'allowed-after-loss');
    assert.equal(allowed.status, 201);
    assert.equal(allowed.body?.ok, true);
  });

  test('Starter active capacity is released after a terminal won outcome', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'starter_active_release_won';
    const email = 'starter.active.release.won@example.com';
    const cookie = authCookie(userId, email);
    await seedUserAndPlan(userId, email, 'starter');

    const previousMonth = startOfPreviousUtcMonth();
    await seedProposal(userId, 'active-release-won-1', {
      id: 'active_release_won_p1',
      status: 'draft',
      createdAt: previousMonth,
      updatedAt: previousMonth,
    });

    const blocked = await createProposalViaApi(cookie, 'blocked-before-won-release');
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body?.error?.code, 'starter_active_opportunities_limit_reached');

    const db = await getDb();
    const wonAt = new Date();
    await db
      .update(schema.proposals)
      .set({
        status: 'won',
        partyAOutcome: 'won',
        partyAOutcomeAt: wonAt,
        partyBOutcome: 'won',
        partyBOutcomeAt: wonAt,
        closedAt: wonAt,
        updatedAt: wonAt,
      })
      .where(eq(schema.proposals.id, 'active_release_won_p1'));

    const allowed = await createProposalViaApi(cookie, 'allowed-after-won');
    assert.equal(allowed.status, 201);
    assert.equal(allowed.body?.ok, true);
  });

  test('Starter upload usage is recorded only after successful extract processing', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'starter_extract_usage_timing';
    const email = 'starter.extract.usage@example.com';
    const cookie = authCookie(userId, email);
    await seedUserAndPlan(userId, email, 'starter');

    const badReq = createMockReq({
      method: 'POST',
      url: '/api/documents/extract',
      headers: { cookie },
      body: {
        filename: 'invalid.pdf',
        mimeType: 'application/pdf',
        fileBase64: Buffer.from('not a real pdf').toString('base64'),
      },
    });
    const badRes = createMockRes();
    await documentsExtractHandler(badReq, badRes);
    assert.equal(badRes.statusCode, 400);

    const db = await getDb();
    const usageAfterFailure = await db
      .select({ count: schema.starterUsageEvents.id })
      .from(schema.starterUsageEvents)
      .where(eq(schema.starterUsageEvents.userId, userId));
    assert.equal(usageAfterFailure.length, 0);
  });

  test('Starter upload retries only record successful persisted uploads', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'starter_upload_retry_dedupe';
    const email = 'starter.upload.retry@example.com';
    const cookie = authCookie(userId, email);
    await seedUserAndPlan(userId, email, 'starter');

    const invalidReq = createMockReq({
      method: 'POST',
      url: '/api/documents/upload',
      headers: { cookie },
      body: {
        filename: 'retry.txt',
        mimeType: 'text/plain',
        fileBase64: '!!!invalidbase64!!!',
      },
    });
    const invalidRes = createMockRes();
    await documentsHandler(invalidReq, invalidRes);
    assert.equal(invalidRes.statusCode, 400);

    const successReq = createMockReq({
      method: 'POST',
      url: '/api/documents/upload',
      headers: { cookie },
      body: {
        filename: 'retry.txt',
        mimeType: 'text/plain',
        fileBase64: Buffer.from('retry-ok').toString('base64'),
      },
    });
    const successRes = createMockRes();
    await documentsHandler(successReq, successRes);
    assert.equal(successRes.statusCode, 201);

    const db = await getDb();
    const usageRows = await db
      .select({ quantity: schema.starterUsageEvents.quantity })
      .from(schema.starterUsageEvents)
      .where(eq(schema.starterUsageEvents.userId, userId));
    assert.equal(usageRows.length, 1);
    assert.equal(Number(usageRows[0]?.quantity || 0), Buffer.from('retry-ok').length);
  });
}

// ---------------------------------------------------------------------------
// Trial expiry tests
// ---------------------------------------------------------------------------
serialTest('Beta signup with future trialEndsAt is treated as Early Access (not capped)', async () => {
  if (!hasDatabaseUrl()) return;
  await ensureMigrated();
  await resetTables();

  const userId = 'beta_future_trial';
  const email = 'beta-future-trial@example.com';
  const cookie = authCookie(userId, email);

  const db = await getDb();
  await db.insert(schema.users).values({ id: userId, email }).onConflictDoNothing({ target: schema.users.id });

  const futureDate = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000); // 25 days from now
  await db
    .insert(schema.betaSignups)
    .values({
      id: randomUUID(),
      email,
      emailNormalized: email.toLowerCase(),
      userId,
      source: 'pricing',
      createdAt: new Date(),
      trialEndsAt: futureDate,
    })
    .onConflictDoNothing({ target: schema.betaSignups.emailNormalized });

  await seedProposal(userId, 'trial-future-p1');
  await seedProposal(userId, 'trial-future-p2');
  await seedProposal(userId, 'trial-future-p3');

  const result = await createProposalViaApi(cookie, 'trial-future-p4-should-pass');
  assert.equal(
    result.status,
    201,
    `Active beta trial must not be starter-capped: ${JSON.stringify(result.body)}`,
  );
  assert.equal(result.body?.ok, true);
});

serialTest('Beta signup with past trialEndsAt falls back to Starter (IS capped)', async () => {
  if (!hasDatabaseUrl()) return;
  await ensureMigrated();
  await resetTables();

  const userId = 'beta_expired_trial';
  const email = 'beta-expired-trial@example.com';
  const cookie = authCookie(userId, email);

  const db = await getDb();
  await db.insert(schema.users).values({ id: userId, email }).onConflictDoNothing({ target: schema.users.id });

  const pastDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // 1 day ago
  await db
    .insert(schema.betaSignups)
    .values({
      id: randomUUID(),
      email,
      emailNormalized: email.toLowerCase(),
      userId,
      source: 'pricing',
      createdAt: new Date(Date.now() - 32 * 24 * 60 * 60 * 1000),
      trialEndsAt: pastDate,
    })
    .onConflictDoNothing({ target: schema.betaSignups.emailNormalized });

  await seedProposal(userId, 'trial-expired-p1');

  const result = await createProposalViaApi(cookie, 'trial-expired-p2-should-be-blocked');
  assert.equal(
    result.status,
    429,
    `Expired beta trial must fall back to starter cap: ${JSON.stringify(result.body)}`,
  );
  assert.equal(result.body?.error?.code, 'starter_opportunities_monthly_limit_reached');
});

serialTest('Beta signup with NULL trialEndsAt fails closed to Starter', async () => {
  if (!hasDatabaseUrl()) return;
  await ensureMigrated();
  await resetTables();

  const userId = 'beta_null_trial';
  const email = 'beta-null-trial@example.com';
  const cookie = authCookie(userId, email);

  const db = await getDb();
  await db.insert(schema.users).values({ id: userId, email }).onConflictDoNothing({ target: schema.users.id });

  // Explicitly insert with trialEndsAt = null (legacy row)
  await db
    .insert(schema.betaSignups)
    .values({
      id: randomUUID(),
      email,
      emailNormalized: email.toLowerCase(),
      userId,
      source: 'pricing',
      createdAt: new Date(),
      trialEndsAt: null,
    })
    .onConflictDoNothing({ target: schema.betaSignups.emailNormalized });

  await seedProposal(userId, 'trial-null-p1');

  const result = await createProposalViaApi(cookie, 'trial-null-p2-should-be-blocked');
  assert.equal(
    result.status,
    429,
    `Legacy beta row with NULL trialEndsAt must fall back to starter cap: ${JSON.stringify(result.body)}`,
  );
  assert.equal(result.body?.error?.code, 'starter_opportunities_monthly_limit_reached');
});

serialTest('Paid subscriber with expired beta row still gets professional plan (billing wins)', async () => {
  if (!hasDatabaseUrl()) return;
  await ensureMigrated();
  await resetTables();

  const userId = 'paid_with_expired_beta';
  const email = 'paid-expired-beta@example.com';
  const cookie = authCookie(userId, email);

  const db = await getDb();
  await db.insert(schema.users).values({ id: userId, email }).onConflictDoNothing({ target: schema.users.id });

  // Active professional billing row
  await db
    .insert(schema.billingReferences)
    .values({ userId, plan: 'professional', status: 'active', updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.billingReferences.userId,
      set: { plan: 'professional', status: 'active', updatedAt: new Date() },
    });

  // Expired beta row — should not affect plan
  const pastDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
  await db
    .insert(schema.betaSignups)
    .values({
      id: randomUUID(),
      email,
      emailNormalized: email.toLowerCase(),
      userId,
      source: 'pricing',
      createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
      trialEndsAt: pastDate,
    })
    .onConflictDoNothing({ target: schema.betaSignups.emailNormalized });

  await seedProposal(userId, 'paid-expired-beta-p1');
  await seedProposal(userId, 'paid-expired-beta-p2');
  await seedProposal(userId, 'paid-expired-beta-p3');

  // Professional users are never capped
  const result = await createProposalViaApi(cookie, 'paid-expired-beta-p4-must-pass');
  assert.equal(
    result.status,
    201,
    `Professional billing wins over expired beta row: ${JSON.stringify(result.body)}`,
  );
  assert.equal(result.body?.ok, true);
});
