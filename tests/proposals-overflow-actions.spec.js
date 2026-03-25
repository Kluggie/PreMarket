import { test, expect } from '@playwright/test';
import { ensureTestEnv, makeSessionCookie } from './helpers/auth.mjs';

const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://127.0.0.1:4273';
const LOAD_TIMEOUT_MS = 20_000;

ensureTestEnv();

function uniqueId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseCookie(rawCookie) {
  const separatorIndex = String(rawCookie || '').indexOf('=');
  if (separatorIndex <= 0) {
    throw new Error('Invalid session cookie format');
  }

  return {
    name: rawCookie.slice(0, separatorIndex),
    value: rawCookie.slice(separatorIndex + 1),
  };
}

async function applySessionCookie(context, rawCookie) {
  const cookie = parseCookie(rawCookie);
  await context.addCookies([
    {
      name: cookie.name,
      value: cookie.value,
      url: BASE_URL,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}

function makeUser(userId, email) {
  return {
    id: userId,
    sub: userId,
    email,
    name: 'Overflow Actions User',
    full_name: 'Overflow Actions User',
    role: 'user',
    plan_tier: 'professional',
    subscription_status: 'active',
    stripe_customer_id: null,
    stripe_subscription_id: null,
    cancel_at_period_end: false,
    current_period_end: null,
    created_date: null,
  };
}

function makeProposal(overrides = {}) {
  const proposalId = overrides.id || uniqueId('proposal');
  const now = new Date('2026-03-25T10:00:00.000Z').toISOString();
  return {
    id: proposalId,
    title: overrides.title || `Proposal ${proposalId}`,
    status: overrides.status || 'sent',
    status_reason: null,
    directional_status: overrides.directional_status || overrides.status || 'sent',
    primary_status_key: overrides.primary_status_key || 'waiting_on_counterparty',
    primary_status_label: overrides.primary_status_label || 'Waiting on Counterparty',
    outcome: {
      actor_role: 'party_a',
      state: 'open',
      final_status: null,
      pending: false,
      requested_by: null,
      requested_at: null,
      requested_by_current_user: false,
      requested_by_counterparty: false,
      party_a_outcome: null,
      party_a_outcome_at: null,
      party_b_outcome: null,
      party_b_outcome_at: null,
      can_mark_won: true,
      can_mark_lost: true,
      can_continue_negotiating: false,
      eligibility_reason: null,
      eligibility_reason_won: null,
      eligibility_reason_lost: null,
      ...(overrides.outcome || {}),
    },
    list_type: overrides.list_type || 'sent',
    shared_report_token: null,
    shared_report_status: null,
    shared_report_expires_at: null,
    shared_report_last_updated_at: null,
    shared_report_sent_at: null,
    template_id: null,
    template_name: null,
    proposal_type: 'standard',
    draft_step: 1,
    resume_step: 1,
    source_proposal_id: null,
    document_comparison_id: null,
    party_a_email: overrides.party_a_email || 'owner@example.com',
    party_b_email: overrides.party_b_email || 'recipient@example.com',
    party_b_name: overrides.party_b_name || 'Recipient',
    summary: overrides.summary || 'Proposal summary',
    payload: {},
    recipient_email: overrides.party_b_email || 'recipient@example.com',
    counterparty_email: overrides.counterparty_email || 'recipient@example.com',
    owner_user_id: overrides.owner_user_id || 'owner_user',
    sent_at: overrides.sent_at || now,
    received_at: overrides.received_at || null,
    last_thread_activity_at: overrides.last_thread_activity_at || now,
    last_thread_actor_role: 'party_a',
    last_thread_activity_type: 'proposal.sent',
    evaluated_at: null,
    last_shared_at: null,
    archived_at: overrides.archived_at || null,
    closed_at: overrides.closed_at || null,
    party_a_outcome: overrides.party_a_outcome || null,
    party_a_outcome_at: overrides.party_a_outcome_at || null,
    party_b_outcome: overrides.party_b_outcome || null,
    party_b_outcome_at: overrides.party_b_outcome_at || null,
    thread_bucket: overrides.thread_bucket || 'inbox',
    latest_direction: overrides.latest_direction || 'sent',
    started_by_role: overrides.started_by_role || 'you',
    last_update_by_role: overrides.last_update_by_role || 'you',
    exchange_count: overrides.exchange_count ?? 1,
    needs_response: Boolean(overrides.needs_response),
    waiting_on_other_party:
      overrides.waiting_on_other_party === undefined ? true : Boolean(overrides.waiting_on_other_party),
    win_confirmation_requested: Boolean(overrides.win_confirmation_requested),
    review_status: overrides.review_status || null,
    is_mutual_interest: Boolean(overrides.is_mutual_interest),
    is_latest_version: true,
    last_activity_at: overrides.last_activity_at || now,
    is_private_mode: false,
    user_id: overrides.user_id || 'owner_user',
    created_at: overrides.created_at || now,
    updated_at: overrides.updated_at || now,
    created_date: overrides.created_at || now,
    updated_date: overrides.updated_at || now,
  };
}

function buildSummary(proposals) {
  const activeRows = proposals.filter((proposal) => proposal.thread_bucket !== 'archived');
  return {
    inboxCount: proposals.filter((proposal) => proposal.thread_bucket === 'inbox').length,
    draftsCount: proposals.filter((proposal) => proposal.thread_bucket === 'drafts').length,
    closedCount: proposals.filter((proposal) => proposal.thread_bucket === 'closed').length,
    archivedCount: proposals.filter((proposal) => proposal.thread_bucket === 'archived').length,
    sentCount: activeRows.filter((proposal) => proposal.list_type === 'sent').length,
    receivedCount: activeRows.filter((proposal) => proposal.list_type === 'received').length,
    mutualInterestCount: activeRows.filter((proposal) => proposal.is_mutual_interest).length,
    wonCount: activeRows.filter((proposal) => proposal.status === 'won').length,
    lostCount: activeRows.filter((proposal) => proposal.status === 'lost').length,
    totalCount: activeRows.length,
    starterUsage: {
      plan: 'professional',
      usage: 0,
      limit: 100,
    },
  };
}

function filterProposals(proposals, url) {
  const rawTab = url.searchParams.get('tab') || 'all';
  const tab = rawTab.toLowerCase();
  const status = (url.searchParams.get('status') || 'all').toLowerCase();

  return proposals.filter((proposal) => {
    if (tab === 'inbox' && proposal.thread_bucket !== 'inbox') return false;
    if (tab === 'closed' && proposal.thread_bucket !== 'closed') return false;
    if (tab === 'archived' && proposal.thread_bucket !== 'archived') return false;
    if (tab === 'drafts' && proposal.thread_bucket !== 'drafts') return false;
    if (tab === 'all' && proposal.thread_bucket === 'archived') return false;
    if (status === 'win_confirmation_requested' && !proposal.win_confirmation_requested) return false;
    return true;
  });
}

function updateProposal(proposals, proposalId, updater) {
  const index = proposals.findIndex((proposal) => proposal.id === proposalId);
  if (index < 0) {
    return null;
  }
  proposals[index] = updater({ ...proposals[index] });
  return proposals[index];
}

async function installProposalApiMocks(page, { user, proposals, failOutcomeProposalId = null, onOutcomeRequest = null }) {
  await page.route(
    (url) => new URL(url).pathname.startsWith('/api/'),
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const pathname = url.pathname;
      const method = request.method().toUpperCase();

      if (pathname === '/api/auth/csrf' && method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ csrfToken: 'test-csrf-token' }),
        });
        return;
      }

      if (pathname === '/api/auth/me' && method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ user }),
        });
        return;
      }

      if (pathname === '/api/notifications' && method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ notifications: [] }),
        });
        return;
      }

      if (pathname === '/api/dashboard/summary' && method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ summary: buildSummary(proposals) }),
        });
        return;
      }

      if (pathname === '/api/proposals' && method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            proposals: filterProposals(proposals, url),
            page: {
              limit: 20,
              nextCursor: null,
              hasMore: false,
            },
          }),
        });
        return;
      }

      const outcomeMatch = pathname.match(/^\/api\/proposals\/([^/]+)\/outcome$/);
      if (outcomeMatch && method === 'POST') {
        const proposalId = decodeURIComponent(outcomeMatch[1]);
        if (typeof onOutcomeRequest === 'function') {
          onOutcomeRequest(proposalId);
        }

        if (proposalId === failOutcomeProposalId) {
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({
              error: {
                code: 'forced_failure',
                message: 'Forced failure for overflow action test',
              },
            }),
          });
          return;
        }

        const body = request.postDataJSON() || {};
        const requestedOutcome = String(body.outcome || body.action || '').toLowerCase();
        const updatedProposal = updateProposal(proposals, proposalId, (proposal) => {
          const now = new Date('2026-03-25T10:30:00.000Z').toISOString();
          if (requestedOutcome === 'lost') {
            return {
              ...proposal,
              status: 'lost',
              directional_status: 'lost',
              primary_status_key: 'closed_lost',
              primary_status_label: 'Closed: Lost',
              thread_bucket: 'closed',
              waiting_on_other_party: false,
              win_confirmation_requested: false,
              closed_at: now,
              last_activity_at: now,
              updated_at: now,
              updated_date: now,
              outcome: {
                ...proposal.outcome,
                state: 'lost',
                final_status: 'lost',
                pending: false,
                requested_by_current_user: false,
                requested_by_counterparty: false,
              },
            };
          }

          return {
            ...proposal,
            primary_status_key: 'waiting_on_counterparty',
            primary_status_label: 'Waiting on Counterparty',
            waiting_on_other_party: true,
            win_confirmation_requested: false,
            last_activity_at: now,
            updated_at: now,
            updated_date: now,
            outcome: {
              ...proposal.outcome,
              state: 'pending_won',
              final_status: null,
              pending: true,
              requested_by_current_user: true,
              requested_by_counterparty: false,
              requested_at: now,
            },
          };
        });

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ proposal: updatedProposal }),
        });
        return;
      }

      const archiveMatch = pathname.match(/^\/api\/proposals\/([^/]+)\/archive$/);
      if (archiveMatch && method === 'PATCH') {
        const proposalId = decodeURIComponent(archiveMatch[1]);
        const updatedProposal = updateProposal(proposals, proposalId, (proposal) => {
          const now = new Date('2026-03-25T10:45:00.000Z').toISOString();
          return {
            ...proposal,
            thread_bucket: 'archived',
            archived_at: now,
            last_activity_at: now,
            updated_at: now,
            updated_date: now,
          };
        });

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ proposal: updatedProposal }),
        });
        return;
      }

      const proposalMatch = pathname.match(/^\/api\/proposals\/([^/]+)$/);
      if (proposalMatch && method === 'DELETE') {
        const proposalId = decodeURIComponent(proposalMatch[1]);
        const index = proposals.findIndex((proposal) => proposal.id === proposalId);
        if (index >= 0) {
          proposals.splice(index, 1);
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            deleted: true,
            mode: 'soft',
          }),
        });
        return;
      }

      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'not_found',
            message: `No mocked handler for ${method} ${pathname}`,
          },
        }),
      });
    },
  );
}

async function openProposalsInbox(page, sessionCookie) {
  await applySessionCookie(page.context(), sessionCookie);
  await page.goto(`${BASE_URL}/Proposals?tab=inbox`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Opportunities' })).toBeVisible({
    timeout: LOAD_TIMEOUT_MS,
  });
}

async function openActionsMenu(page, proposalId) {
  await page.getByTestId(`proposal-actions-${proposalId}`).click();
}

async function expectRowVisible(page, proposalId) {
  await expect(page.getByTestId(`proposal-row-${proposalId}`)).toBeVisible({
    timeout: LOAD_TIMEOUT_MS,
  });
}

test.describe('Proposals overflow actions', () => {
  test.describe.configure({ timeout: 60_000 });

  test('Mark as Lost moves the row from Inbox to Closed through the overflow menu', async ({ page }) => {
    const userId = uniqueId('overflow_lost_user');
    const userEmail = `${userId}@example.com`;
    const sessionCookie = makeSessionCookie({
      sub: userId,
      email: userEmail,
      name: 'Overflow Lost User',
    });
    const proposal = makeProposal({
      id: uniqueId('lost_row'),
      title: 'Overflow Lost Row',
      party_a_email: userEmail,
      thread_bucket: 'inbox',
      primary_status_key: 'waiting_on_counterparty',
      primary_status_label: 'Waiting on Counterparty',
      outcome: {
        can_mark_won: false,
        can_mark_lost: true,
        eligibility_reason_won: 'The proposer can only request agreement after the recipient responds at least once.',
      },
    });

    const proposals = [proposal];
    await installProposalApiMocks(page, {
      user: makeUser(userId, userEmail),
      proposals,
    });
    await openProposalsInbox(page, sessionCookie);
    await expectRowVisible(page, proposal.id);

    await openActionsMenu(page, proposal.id);
    await page.getByRole('menuitem', { name: 'Mark as Lost' }).click();
    await expect(page.getByTestId(`proposal-row-${proposal.id}`)).toHaveCount(0, {
      timeout: LOAD_TIMEOUT_MS,
    });

    await page.getByRole('tab', { name: /Closed/ }).click();
    await expectRowVisible(page, proposal.id);
    await expect(page.getByTestId(`proposal-row-${proposal.id}`)).toContainText('Closed: Lost');
  });

  test('Request Agreement shows the gating reason when disabled and updates the row when enabled', async ({ page }) => {
    const userId = uniqueId('overflow_agreement_user');
    const userEmail = `${userId}@example.com`;
    const sessionCookie = makeSessionCookie({
      sub: userId,
      email: userEmail,
      name: 'Overflow Agreement User',
    });
    const blockedProposal = makeProposal({
      id: uniqueId('blocked_row'),
      title: 'Blocked Agreement Row',
      party_a_email: userEmail,
      primary_status_key: 'waiting_on_counterparty',
      primary_status_label: 'Waiting on Counterparty',
      outcome: {
        can_mark_won: false,
        can_mark_lost: true,
        eligibility_reason_won: 'The proposer can only request agreement after the recipient responds at least once.',
      },
    });
    const enabledProposal = makeProposal({
      id: uniqueId('enabled_row'),
      title: 'Enabled Agreement Row',
      party_a_email: userEmail,
      status: 'received',
      directional_status: 'received',
      latest_direction: 'received',
      list_type: 'sent',
      received_at: new Date('2026-03-25T10:10:00.000Z').toISOString(),
      primary_status_key: 'needs_reply',
      primary_status_label: 'Needs Reply',
      needs_response: true,
      waiting_on_other_party: false,
      outcome: {
        can_mark_won: true,
        can_mark_lost: true,
      },
    });

    let outcomeRequests = 0;
    const proposals = [blockedProposal, enabledProposal];
    await installProposalApiMocks(page, {
      user: makeUser(userId, userEmail),
      proposals,
      onOutcomeRequest: () => {
        outcomeRequests += 1;
      },
    });
    await openProposalsInbox(page, sessionCookie);
    await expectRowVisible(page, blockedProposal.id);
    await expectRowVisible(page, enabledProposal.id);

    await openActionsMenu(page, blockedProposal.id);
    const blockedRequestAgreement = page.getByRole('menuitem', { name: 'Request Agreement' });
    await expect(blockedRequestAgreement).toHaveAttribute('data-disabled', '');
    await expect(
      page.getByText('The proposer can only request agreement after the recipient responds at least once.'),
    ).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
    expect(outcomeRequests).toBe(0);
    await page.keyboard.press('Escape');

    await openActionsMenu(page, enabledProposal.id);
    await page.getByRole('menuitem', { name: 'Request Agreement' }).click();
    await expect(page.getByTestId(`proposal-row-${enabledProposal.id}`)).toContainText('Waiting on Counterparty');

    await openActionsMenu(page, enabledProposal.id);
    await expect(page.getByText('Waiting for the counterparty to confirm the agreement.')).toBeVisible({
      timeout: LOAD_TIMEOUT_MS,
    });
    expect(outcomeRequests).toBe(1);
  });

  test('Archive and Delete both remove stale rows from the active list', async ({ page }) => {
    const userId = uniqueId('overflow_archive_delete_user');
    const userEmail = `${userId}@example.com`;
    const sessionCookie = makeSessionCookie({
      sub: userId,
      email: userEmail,
      name: 'Overflow Archive Delete User',
    });
    const archivedProposal = makeProposal({
      id: uniqueId('archive_row'),
      title: 'Archive Action Row',
      party_a_email: userEmail,
    });
    const deletedProposal = makeProposal({
      id: uniqueId('delete_row'),
      title: 'Delete Action Row',
      party_a_email: userEmail,
    });

    const proposals = [archivedProposal, deletedProposal];
    await installProposalApiMocks(page, {
      user: makeUser(userId, userEmail),
      proposals,
    });
    await openProposalsInbox(page, sessionCookie);
    await expectRowVisible(page, archivedProposal.id);
    await expectRowVisible(page, deletedProposal.id);

    await openActionsMenu(page, archivedProposal.id);
    await page.getByRole('menuitem', { name: 'Archive' }).click();
    await expect(page.getByTestId(`proposal-row-${archivedProposal.id}`)).toHaveCount(0, {
      timeout: LOAD_TIMEOUT_MS,
    });

    await page.getByRole('tab', { name: /Archived/ }).click();
    await expectRowVisible(page, archivedProposal.id);

    await page.getByRole('tab', { name: /Inbox/ }).click();
    await openActionsMenu(page, deletedProposal.id);
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByTestId(`proposal-row-${deletedProposal.id}`)).toHaveCount(0, {
      timeout: LOAD_TIMEOUT_MS,
    });
  });

  test('Failed menu mutations surface an error toast instead of silently no-oping', async ({ page }) => {
    const userId = uniqueId('overflow_error_user');
    const userEmail = `${userId}@example.com`;
    const sessionCookie = makeSessionCookie({
      sub: userId,
      email: userEmail,
      name: 'Overflow Error User',
    });
    const proposal = makeProposal({
      id: uniqueId('error_row'),
      title: 'Error Action Row',
      party_a_email: userEmail,
      outcome: {
        can_mark_won: false,
        can_mark_lost: true,
        eligibility_reason_won: 'The proposer can only request agreement after the recipient responds at least once.',
      },
    });

    await installProposalApiMocks(page, {
      user: makeUser(userId, userEmail),
      proposals: [proposal],
      failOutcomeProposalId: proposal.id,
    });
    await openProposalsInbox(page, sessionCookie);
    await expectRowVisible(page, proposal.id);

    await openActionsMenu(page, proposal.id);
    await page.getByRole('menuitem', { name: 'Mark as Lost' }).click();
    await expect(page.getByText('Forced failure for overflow action test')).toBeVisible({
      timeout: LOAD_TIMEOUT_MS,
    });
    await expectRowVisible(page, proposal.id);
  });
});
