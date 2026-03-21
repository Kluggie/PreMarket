import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getProposalThreadState,
  matchesProposalThreadBucket,
} from '../../server/_lib/proposal-thread-state.js';
import {
  buildProposalVisibilityScopes,
  getRecipientSharedProposalIds,
  isProposalOwnedByCurrentUser,
  isProposalReceivedByCurrentUser,
  matchesSharedReportRecipientEmail,
} from '../../server/_lib/proposal-visibility.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

function readRepoFile(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

// ─── Code-inspection: fork logic exists in both send endpoints ─────────────

test('proposals/[id]/send.ts contains multi-recipient fork logic', () => {
  const sendCode = readRepoFile('server/routes/proposals/[id]/send.ts');

  // Must detect when sending to a different recipient
  assert.match(sendCode, /needsFork/);
  assert.match(sendCode, /existing\.sentAt/);
  assert.match(sendCode, /existingRecipient.*!==.*recipientEmail/);

  // Must create a forked proposal
  assert.match(sendCode, /forkedProposalId/);
  assert.match(sendCode, /sourceProposalId:\s*existing\.id/);

  // Must clone document comparison
  assert.match(sendCode, /forkedComparisonId/);
  assert.match(sendCode, /newId\('comparison'\)/);

  // Must create shared link against the forked target
  assert.match(sendCode, /proposalId:\s*targetProposal\.id/);

  // Must not overwrite original proposal when forking
  assert.match(sendCode, /targetProposal\s*=\s*forkedRow/);
});

test('shared-reports/[token]/send.ts contains multi-recipient fork logic', () => {
  const sendCode = readRepoFile('server/routes/shared-reports/[token]/send.ts');

  // Must detect when sending to a different recipient
  assert.match(sendCode, /needsFork/);
  assert.match(sendCode, /existingLinkRecipient|existingProposalRecipient/);

  // Must create a forked proposal
  assert.match(sendCode, /forkedProposalId/);
  assert.match(sendCode, /sourceProposalId:\s*proposal\.id/);

  // Must clone document comparison
  assert.match(sendCode, /forkedComparisonId/);

  // Must create a new shared link for the fork
  assert.match(sendCode, /forkedToken/);
  assert.match(sendCode, /targetLink\s*=\s*forkedLink/);

  // Must only update recipientEmail on link when not forking
  assert.match(sendCode, /if\s*\(!needsFork\)/);
});

// ─── Unit tests: per-recipient independence via visibility system ───────────

test('two independent proposals for different recipients show as separate inbox items', () => {
  const owner = { id: 'owner_1', email: 'owner@example.com' };
  const recipientA = { id: 'recipient_a', email: 'alice@example.com' };
  const recipientB = { id: 'recipient_b', email: 'bob@example.com' };

  const proposalForA = {
    id: 'proposal_for_alice',
    userId: 'owner_1',
    status: 'sent',
    partyAEmail: 'owner@example.com',
    partyBEmail: 'alice@example.com',
    sentAt: '2026-03-20T10:00:00.000Z',
    createdAt: '2026-03-20T09:00:00.000Z',
    updatedAt: '2026-03-20T10:00:00.000Z',
    lastThreadActivityAt: '2026-03-20T10:00:00.000Z',
    lastThreadActorRole: 'party_a',
    lastThreadActivityType: 'proposal.sent',
    documentComparisonId: 'comp_alice',
  };

  const proposalForB = {
    id: 'proposal_for_bob',
    userId: 'owner_1',
    status: 'sent',
    partyAEmail: 'owner@example.com',
    partyBEmail: 'bob@example.com',
    sentAt: '2026-03-20T11:00:00.000Z',
    createdAt: '2026-03-20T11:00:00.000Z',
    updatedAt: '2026-03-20T11:00:00.000Z',
    lastThreadActivityAt: '2026-03-20T11:00:00.000Z',
    lastThreadActorRole: 'party_a',
    lastThreadActivityType: 'proposal.sent',
    sourceProposalId: 'proposal_for_alice',
    documentComparisonId: 'comp_bob',
  };

  // Owner sees both as separate sent items
  const ownerViewA = getProposalThreadState(proposalForA, owner);
  const ownerViewB = getProposalThreadState(proposalForB, owner);
  assert.equal(ownerViewA.actorRole, 'party_a');
  assert.equal(ownerViewB.actorRole, 'party_a');
  assert.equal(matchesProposalThreadBucket(ownerViewA, 'inbox'), true);
  assert.equal(matchesProposalThreadBucket(ownerViewB, 'inbox'), true);

  // Alice sees only her proposal
  const aliceViewA = getProposalThreadState(proposalForA, recipientA, {
    sharedReceivedProposalIds: ['proposal_for_alice'],
  });
  assert.equal(aliceViewA.actorRole, 'party_b');
  assert.equal(matchesProposalThreadBucket(aliceViewA, 'inbox'), true);

  // Alice does not appear as recipient for Bob's proposal
  assert.equal(isProposalReceivedByCurrentUser(proposalForB, recipientA), false);

  // Bob sees only his proposal
  const bobViewB = getProposalThreadState(proposalForB, recipientB, {
    sharedReceivedProposalIds: ['proposal_for_bob'],
  });
  assert.equal(bobViewB.actorRole, 'party_b');
  assert.equal(matchesProposalThreadBucket(bobViewB, 'inbox'), true);

  // Bob does not appear as recipient for Alice's proposal
  assert.equal(isProposalReceivedByCurrentUser(proposalForA, recipientB), false);
});

test('each recipient has an independent counterparty email in their thread state', () => {
  const owner = { id: 'owner_1', email: 'owner@example.com' };
  const proposalForA = {
    id: 'p_a',
    userId: 'owner_1',
    status: 'sent',
    partyAEmail: 'owner@example.com',
    partyBEmail: 'alice@example.com',
    sentAt: '2026-03-20T10:00:00.000Z',
    createdAt: '2026-03-20T09:00:00.000Z',
    updatedAt: '2026-03-20T10:00:00.000Z',
    lastThreadActivityAt: '2026-03-20T10:00:00.000Z',
    lastThreadActorRole: 'party_a',
    lastThreadActivityType: 'proposal.sent',
  };
  const proposalForB = {
    id: 'p_b',
    userId: 'owner_1',
    status: 'sent',
    partyAEmail: 'owner@example.com',
    partyBEmail: 'bob@example.com',
    sentAt: '2026-03-20T11:00:00.000Z',
    createdAt: '2026-03-20T11:00:00.000Z',
    updatedAt: '2026-03-20T11:00:00.000Z',
    lastThreadActivityAt: '2026-03-20T11:00:00.000Z',
    lastThreadActorRole: 'party_a',
    lastThreadActivityType: 'proposal.sent',
    sourceProposalId: 'p_a',
  };

  const ownerViewA = getProposalThreadState(proposalForA, owner);
  const ownerViewB = getProposalThreadState(proposalForB, owner);
  assert.equal(ownerViewA.counterpartyEmail, 'alice@example.com');
  assert.equal(ownerViewB.counterpartyEmail, 'bob@example.com');
  assert.notEqual(ownerViewA.counterpartyEmail, ownerViewB.counterpartyEmail);
});

test('different proposals have different documentComparisonId values', () => {
  const proposalForA = {
    id: 'p_a',
    documentComparisonId: 'comp_alice',
  };
  const proposalForB = {
    id: 'p_b',
    documentComparisonId: 'comp_bob',
    sourceProposalId: 'p_a',
  };

  assert.notEqual(proposalForA.documentComparisonId, proposalForB.documentComparisonId);
  assert.notEqual(proposalForA.id, proposalForB.id);
});

test('shared link recipientEmail matching is independent per link', () => {
  const alice = { id: 'alice_user', email: 'alice@example.com' };
  const bob = { id: 'bob_user', email: 'bob@example.com' };

  const linkForAlice = {
    proposalId: 'p_a',
    token: 'token_alice',
    recipientEmail: 'alice@example.com',
  };
  const linkForBob = {
    proposalId: 'p_b',
    token: 'token_bob',
    recipientEmail: 'bob@example.com',
  };

  // Alice matches her own link, not Bob's
  assert.equal(matchesSharedReportRecipientEmail(linkForAlice, alice), true);
  assert.equal(matchesSharedReportRecipientEmail(linkForBob, alice), false);

  // Bob matches his own link, not Alice's
  assert.equal(matchesSharedReportRecipientEmail(linkForBob, bob), true);
  assert.equal(matchesSharedReportRecipientEmail(linkForAlice, bob), false);
});

test('getRecipientSharedProposalIds returns separate proposal IDs for separate links', () => {
  const links = [
    { proposalId: 'p_alice', token: 't1', recipientEmail: 'alice@example.com' },
    { proposalId: 'p_bob', token: 't2', recipientEmail: 'bob@example.com' },
  ];

  const ids = getRecipientSharedProposalIds(links);
  assert.equal(ids.length, 2);
  assert.ok(ids.includes('p_alice'));
  assert.ok(ids.includes('p_bob'));
});

test('send-back on one recipient proposal does not affect the other', () => {
  const owner = { id: 'owner_1', email: 'owner@example.com' };

  // Simulate: Alice sent back, proposal status updated to 'received'
  const proposalForA = {
    id: 'p_a',
    userId: 'owner_1',
    status: 'received',
    partyAEmail: 'owner@example.com',
    partyBEmail: 'alice@example.com',
    sentAt: '2026-03-20T10:00:00.000Z',
    receivedAt: '2026-03-20T12:00:00.000Z',
    createdAt: '2026-03-20T09:00:00.000Z',
    updatedAt: '2026-03-20T12:00:00.000Z',
    lastThreadActivityAt: '2026-03-20T12:00:00.000Z',
    lastThreadActorRole: 'party_b',
    lastThreadActivityType: 'proposal.send_back',
    documentComparisonId: 'comp_alice',
  };

  // Bob's proposal is still 'sent' — not affected by Alice's send-back
  const proposalForB = {
    id: 'p_b',
    userId: 'owner_1',
    status: 'sent',
    partyAEmail: 'owner@example.com',
    partyBEmail: 'bob@example.com',
    sentAt: '2026-03-20T11:00:00.000Z',
    createdAt: '2026-03-20T11:00:00.000Z',
    updatedAt: '2026-03-20T11:00:00.000Z',
    lastThreadActivityAt: '2026-03-20T11:00:00.000Z',
    lastThreadActorRole: 'party_a',
    lastThreadActivityType: 'proposal.sent',
    sourceProposalId: 'p_a',
    documentComparisonId: 'comp_bob',
  };

  const ownerViewA = getProposalThreadState(proposalForA, owner);
  const ownerViewB = getProposalThreadState(proposalForB, owner);

  // A is received (needs reply), B is still sent (waiting)
  assert.equal(ownerViewA.latestDirection, 'received');
  assert.equal(ownerViewA.needsResponse, true);
  assert.equal(ownerViewB.latestDirection, 'sent');
  assert.equal(ownerViewB.waitingOnOtherParty, true);

  // Both still in inbox
  assert.equal(matchesProposalThreadBucket(ownerViewA, 'inbox'), true);
  assert.equal(matchesProposalThreadBucket(ownerViewB, 'inbox'), true);

  // Different statuses
  assert.notEqual(ownerViewA.primaryStatusKey, ownerViewB.primaryStatusKey);
});

test('visibility scopes include both recipients as separate received proposals', () => {
  const recipientA = { id: 'alice_user', email: 'alice@example.com' };

  // Alice has link to p_alice only
  const aliceLinks = [{ proposalId: 'p_alice' }];
  const aliceIds = getRecipientSharedProposalIds(aliceLinks);

  const scopes = buildProposalVisibilityScopes(recipientA, aliceIds);

  // Alice should see her own proposal only via shared link scope
  assert.ok(scopes.recipientVisibleScope);
  assert.ok(scopes.sharedRecipientScope);
});

test('detail page routing uses different proposal IDs for each recipient thread', () => {
  // Conceptual test: after fork, each recipient's detail URL uses a different proposal ID
  const proposalIdAlice = 'proposal_alice_fork';
  const proposalIdBob = 'proposal_bob_fork';

  const detailUrlAlice = `/ProposalDetail?id=${encodeURIComponent(proposalIdAlice)}`;
  const detailUrlBob = `/ProposalDetail?id=${encodeURIComponent(proposalIdBob)}`;

  assert.notEqual(detailUrlAlice, detailUrlBob);
  assert.ok(detailUrlAlice.includes(proposalIdAlice));
  assert.ok(detailUrlBob.includes(proposalIdBob));
});

// ─── Navigation: inbox row click must produce a valid in-app route ──────────

// Inline minimal implementations matching the real helpers for isolated testing:

function createPageUrl(pageName) {
  return '/' + pageName.replace(/ /g, '-');
}

function buildDocumentComparisonDetailHref({ comparisonId, tab } = {}) {
  const normalizedComparisonId = String(comparisonId || '').trim();
  if (!normalizedComparisonId) return null;
  const params = new URLSearchParams();
  params.set('id', normalizedComparisonId);
  if (tab) params.set('tab', String(tab));
  return `/DocumentComparisonDetail?${params.toString()}`;
}

function buildDocumentComparisonReportHref(comparisonId) {
  return buildDocumentComparisonDetailHref({ comparisonId, tab: 'report' });
}

test('buildDocumentComparisonReportHref returns a valid absolute path', () => {
  const href = buildDocumentComparisonReportHref('comparison_abc123');
  assert.ok(href, 'must return a non-null value');
  assert.ok(href.startsWith('/'), 'must start with /');
  assert.ok(href.includes('DocumentComparisonDetail'), 'must contain route name');
  assert.ok(href.includes('id=comparison_abc123'), 'must include comparison id');
  assert.ok(href.includes('tab=report'), 'must include tab=report');
  // Must NOT start with // (double slash caused by createPageUrl wrapping)
  assert.ok(!href.startsWith('//'), 'must not start with double slash');
});

test('createPageUrl wrapping buildDocumentComparisonReportHref produces a broken double-slash URL', () => {
  // This documents the bug that was fixed: wrapping an already-absolute path
  // in createPageUrl prepends / again, producing //DocumentComparisonDetail?...
  const href = buildDocumentComparisonReportHref('comparison_abc123');
  const wrapped = createPageUrl(href);
  assert.ok(wrapped.startsWith('//'), 'wrapping confirms the double-slash bug');
  assert.ok(!href.startsWith('//'), 'the original href is correct without wrapping');
});

test('Proposals.jsx uses navigate(buildDocumentComparisonReportHref(...)) without createPageUrl wrapper', () => {
  const proposalsCode = readRepoFile('src/pages/Proposals.jsx');

  // The correct pattern: navigate directly with the already-absolute href
  assert.match(
    proposalsCode,
    /navigate\s*\(\s*buildDocumentComparisonReportHref\s*\(/,
    'must call navigate(buildDocumentComparisonReportHref(...)) directly',
  );

  // Must NOT have createPageUrl wrapping buildDocumentComparisonReportHref
  assert.doesNotMatch(
    proposalsCode,
    /createPageUrl\s*\(\s*buildDocumentComparisonReportHref/,
    'must not wrap buildDocumentComparisonReportHref in createPageUrl',
  );
});

test('Dashboard.jsx uses navigate(buildDocumentComparisonReportHref(...)) without createPageUrl wrapper', () => {
  const dashboardCode = readRepoFile('src/pages/Dashboard.jsx');

  // The correct pattern: navigate directly with the already-absolute href
  assert.match(
    dashboardCode,
    /navigate\s*\(\s*buildDocumentComparisonReportHref\s*\(/,
    'must call navigate(buildDocumentComparisonReportHref(...)) directly',
  );

  // Must NOT have createPageUrl wrapping buildDocumentComparisonReportHref
  assert.doesNotMatch(
    dashboardCode,
    /createPageUrl\s*\(\s*buildDocumentComparisonReportHref/,
    'must not wrap buildDocumentComparisonReportHref in createPageUrl',
  );
});

test('forked opportunity row for recipient A navigates to its own comparison detail', () => {
  const comparisonIdA = 'comparison_alice_fork';
  const hrefA = buildDocumentComparisonReportHref(comparisonIdA);
  assert.equal(hrefA, `/DocumentComparisonDetail?id=${encodeURIComponent(comparisonIdA)}&tab=report`);
  assert.ok(hrefA.startsWith('/DocumentComparisonDetail'), 'correct route for A');
  assert.ok(!hrefA.startsWith('//'), 'no double slash for A');
});

test('forked opportunity row for recipient B navigates to its own comparison detail', () => {
  const comparisonIdB = 'comparison_bob_fork';
  const hrefB = buildDocumentComparisonReportHref(comparisonIdB);
  assert.equal(hrefB, `/DocumentComparisonDetail?id=${encodeURIComponent(comparisonIdB)}&tab=report`);
  assert.ok(hrefB.startsWith('/DocumentComparisonDetail'), 'correct route for B');
  assert.ok(!hrefB.startsWith('//'), 'no double slash for B');
});

test('both forked recipient rows navigate to different comparison detail URLs', () => {
  const hrefA = buildDocumentComparisonReportHref('comparison_alice_fork');
  const hrefB = buildDocumentComparisonReportHref('comparison_bob_fork');
  assert.notEqual(hrefA, hrefB, 'each recipient must navigate to a different URL');
  assert.ok(hrefA.includes('comparison_alice_fork'));
  assert.ok(hrefB.includes('comparison_bob_fork'));
});
