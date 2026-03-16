import assert from 'node:assert/strict';
import test from 'node:test';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq } from 'drizzle-orm';
import proposalsHandler from '../../server/routes/proposals/index.ts';
import proposalEvaluateHandler from '../../server/routes/proposals/[id]/evaluate.ts';
import templateUseHandler from '../../server/routes/templates/[id]/use.ts';
import documentComparisonsHandler from '../../server/routes/document-comparisons/index.ts';
import documentsHandler from '../../server/routes/documents/index.ts';
import documentsExtractHandler from '../../server/routes/documents/extract.ts';
import { assertStarterAiEvaluationAllowed } from '../../server/_lib/starter-entitlements.ts';
import { ensureTestEnv, makeSessionCookie } from '../helpers/auth.mjs';
import { ensureMigrated, hasDatabaseUrl, resetTables } from '../helpers/db.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';
import * as schema from '../../server/_lib/db/schema.js';

ensureTestEnv();

const MB = 1024 * 1024;

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
    createdAt: partial.createdAt || new Date(),
    updatedAt: partial.updatedAt || new Date(),
    archivedAt: partial.archivedAt || null,
    archivedByPartyAAt: partial.archivedByPartyAAt || null,
    deletedByPartyAAt: partial.deletedByPartyAAt || null,
    partyAOutcome: partial.partyAOutcome || null,
    partyBOutcome: partial.partyBOutcome || null,
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

function startOfPreviousUtcMonth() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0, 0));
}

if (!hasDatabaseUrl()) {
  test('starter limits integration (skipped: DATABASE_URL missing)', { skip: true }, () => {});
} else {
  test('Starter creation limit: /api/proposals blocks after 3 opportunities/month', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'starter_create_monthly';
    const email = 'starter.monthly@example.com';
    const cookie = authCookie(userId, email);
    await seedUserAndPlan(userId, email, 'starter');

    await seedProposal(userId, 'p1');
    await seedProposal(userId, 'p2');
    await seedProposal(userId, 'p3');

    const result = await createProposalViaApi(cookie, 'blocked p4');
    assert.equal(result.status, 429);
    assert.equal(result.body?.error?.code, 'starter_opportunities_monthly_limit_reached');
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
    await seedProposal(userId, 'p2');
    await seedProposal(userId, 'p3');

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

  test('Starter active limit: /api/proposals blocks when 2 active already exist', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'starter_active_limit';
    const email = 'starter.active@example.com';
    const cookie = authCookie(userId, email);
    await seedUserAndPlan(userId, email, 'starter');

    await seedProposal(userId, 'active1', { status: 'draft' });
    await seedProposal(userId, 'active2', { status: 'under_verification' });

    const result = await createProposalViaApi(cookie, 'blocked active 3rd');
    assert.equal(result.status, 429);
    assert.equal(result.body?.error?.code, 'starter_active_opportunities_limit_reached');
  });

  test('Starter evaluation limit: /api/proposals/[id]/evaluate blocks after 10/month', async () => {
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
    for (let i = 0; i < 10; i += 1) {
      await db.insert(schema.proposalEvaluations).values({
        id: `eval_limit_${i}`,
        proposalId: 'proposal_eval_limit_target',
        userId,
        source: 'manual',
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

  test('Starter evaluation pool ignores failed attempts and failed shared-report runs', async () => {
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
        source: 'manual',
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

  test('Starter shared-report evaluations count against the same monthly pool', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'starter_eval_shared_pool';
    const email = 'starter.eval.shared.pool@example.com';
    await seedUserAndPlan(userId, email, 'starter');
    await seedProposal(userId, 'Shared Eval Pool', {
      id: 'proposal_eval_shared_pool',
      partyAEmail: email,
      partyBEmail: 'recipient@example.com',
    });

    const db = await getDb();
    const now = new Date();
    for (let i = 0; i < 9; i += 1) {
      await db.insert(schema.proposalEvaluations).values({
        id: `eval_shared_pool_${i}`,
        proposalId: 'proposal_eval_shared_pool',
        userId,
        source: 'manual',
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

    await seedProposal(userId, 'active-template-1', { status: 'draft' });
    await seedProposal(userId, 'active-template-2', { status: 'under_verification' });

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
    assert.equal(body?.error?.limit, 2);
    assert.equal(body?.error?.used, 2);
  });

  test('Starter active capacity is released after archive semantics mark a row non-active', async () => {
    await ensureMigrated();
    await resetTables();

    const userId = 'starter_active_release';
    const email = 'starter.active.release@example.com';
    const cookie = authCookie(userId, email);
    await seedUserAndPlan(userId, email, 'starter');

    await seedProposal(userId, 'active-release-1', { id: 'active_release_p1', status: 'draft' });
    await seedProposal(userId, 'active-release-2', { id: 'active_release_p2', status: 'sent' });

    const blocked = await createProposalViaApi(cookie, 'blocked-before-release');
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body?.error?.code, 'starter_active_opportunities_limit_reached');

    const db = await getDb();
    await db
      .update(schema.proposals)
      .set({ archivedByPartyAAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.proposals.id, 'active_release_p1'));

    const allowed = await createProposalViaApi(cookie, 'allowed-after-archive');
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
