import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const SRC_ROOT = path.resolve(process.cwd(), 'src');

function srcPath(relative) {
  return path.join(SRC_ROOT, relative);
}

// ─────────────────────────────────────────────────────────────────
//  Regression: no raw "Proposer" / "Recipient" party-role labels
//  in user-facing strings of the affected files.
// ─────────────────────────────────────────────────────────────────

const USER_FACING_FILES = [
  'lib/sharedReportSendDirection.js',
  'pages/SharedReport.jsx',
  'pages/ProposalDetail.jsx',
  'components/document-comparison/Step1AddSources.jsx',
  'components/proposal/GuestEmailCapture.jsx',
];

// Patterns that indicate a raw party-role label leaked into user-facing copy.
// Intentionally narrow to avoid false positives on internal constants / enum values.
const FORBIDDEN_PATTERNS = [
  /['"`]Send to (?:proposer|recipient)['"`]/i,
  /['"`]Sent to (?:proposer|recipient)['"`]/i,
  /['"`]Shared by (?:Proposer|Recipient)['"`]/i,
  /send updates to the (?:proposer|recipient)\./i,
  /title="[^"]*(?:not visible to recipient|recipient-facing)[^"]*"/i,
  /Share opportunity with recipient/i,
];

for (const file of USER_FACING_FILES) {
  test(`no raw party-role labels in ${file}`, async () => {
    const source = await readFile(srcPath(file), 'utf8');
    for (const pattern of FORBIDDEN_PATTERNS) {
      assert.ok(
        !pattern.test(source),
        `Found forbidden pattern ${pattern} in ${file}`,
      );
    }
  });
}

// ─────────────────────────────────────────────────────────────────
//  Structural: sharedReportSendDirection exports getContextualPartyLabel
// ─────────────────────────────────────────────────────────────────

test('sharedReportSendDirection.js exports getContextualPartyLabel', async () => {
  const source = await readFile(srcPath('lib/sharedReportSendDirection.js'), 'utf8');
  assert.ok(
    source.includes('export function getContextualPartyLabel'),
    'getContextualPartyLabel must be exported from sharedReportSendDirection.js',
  );
});

test('buildSharedReportTurnCopy accepts counterpartyName option', async () => {
  const source = await readFile(srcPath('lib/sharedReportSendDirection.js'), 'utf8');
  assert.ok(
    source.includes('counterpartyName'),
    'buildSharedReportTurnCopy must accept counterpartyName in its options',
  );
  assert.ok(
    source.includes('counterpartyDisplay'),
    'buildSharedReportTurnCopy must expose counterpartyDisplay on its return value',
  );
});

// ─────────────────────────────────────────────────────────────────
//  Structural: SharedReport.jsx uses getContextualPartyLabel
// ─────────────────────────────────────────────────────────────────

test('SharedReport.jsx imports getContextualPartyLabel', async () => {
  const source = await readFile(srcPath('pages/SharedReport.jsx'), 'utf8');
  assert.ok(
    source.includes('getContextualPartyLabel'),
    'SharedReport.jsx must import and use getContextualPartyLabel',
  );
});

test('SharedReport.jsx does not define getPartyRoleLabel', async () => {
  const source = await readFile(srcPath('pages/SharedReport.jsx'), 'utf8');
  assert.ok(
    !source.includes('function getPartyRoleLabel'),
    'The old getPartyRoleLabel function must be removed from SharedReport.jsx',
  );
});

// ─────────────────────────────────────────────────────────────────
//  ProposalDetail.jsx: no raw "Proposer:" / "Recipient:" labels
// ─────────────────────────────────────────────────────────────────

test('ProposalDetail.jsx uses "You:" instead of "Proposer:" in metadata', async () => {
  const source = await readFile(srcPath('pages/ProposalDetail.jsx'), 'utf8');
  assert.ok(
    !/>Proposer:</.test(source),
    'ProposalDetail.jsx must not render "Proposer:" as a visible label',
  );
  assert.ok(
    />You:</.test(source),
    'ProposalDetail.jsx must use "You:" for the current user label',
  );
});

// ─────────────────────────────────────────────────────────────────
//  SharedReport.jsx: uses company name fields, not email, for display
// ─────────────────────────────────────────────────────────────────

test('SharedReport.jsx uses proposer_name for display, not proposer_email', async () => {
  const source = await readFile(srcPath('pages/SharedReport.jsx'), 'utf8');
  // Must define proposerDisplayName from parent?.proposer_name
  assert.ok(
    source.includes('proposer_name'),
    'SharedReport.jsx must reference parent.proposer_name for display labels',
  );
  // counterpartyDisplayName must NOT derive from proposer_email
  assert.ok(
    !source.includes('counterpartyName: asText(parent?.proposer_email)'),
    'SharedReport.jsx must not pass proposer_email as counterpartyName',
  );
  assert.ok(
    !source.includes("counterpartyName: senderEmail"),
    'SharedReport.jsx must not pass senderEmail as counterpartyName',
  );
});

test('SharedReport.jsx uses comparison.counterparty_name for recipient display', async () => {
  const source = await readFile(srcPath('pages/SharedReport.jsx'), 'utf8');
  assert.ok(
    source.includes('counterparty_name'),
    'SharedReport.jsx must reference comparison.counterparty_name for recipient display labels',
  );
});

test('SharedReport.jsx history labels use proposerName/recipientName, not email', async () => {
  const source = await readFile(srcPath('pages/SharedReport.jsx'), 'utf8');
  // getContextualPartyLabel calls must use proposerName and recipientName, not senderEmail
  assert.ok(
    source.includes('proposerName: proposerDisplayName'),
    'SharedReport.jsx must pass proposerName (not email) to getContextualPartyLabel',
  );
  assert.ok(
    source.includes('recipientName: recipientDisplayName'),
    'SharedReport.jsx must pass recipientName (not email) to getContextualPartyLabel',
  );
});

test('SharedReport.jsx senderEmail is only used for actual email display', async () => {
  const source = await readFile(srcPath('pages/SharedReport.jsx'), 'utf8');
  // senderEmail should appear only in the definition and in "Sent by" email display contexts
  const senderEmailOccurrences = source.split('senderEmail').length - 1;
  // definition (1) + email display lines (2) = 3 total
  assert.ok(
    senderEmailOccurrences <= 4,
    `senderEmail appears ${senderEmailOccurrences} times — should only be used for email-address display, not UI headings`,
  );
});

// ─────────────────────────────────────────────────────────────────
//  getContextualPartyLabel resolves per-role names correctly
// ─────────────────────────────────────────────────────────────────

test('getContextualPartyLabel accepts proposerName and recipientName', async () => {
  const source = await readFile(srcPath('lib/sharedReportSendDirection.js'), 'utf8');
  assert.ok(
    source.includes('proposerName') && source.includes('recipientName'),
    'getContextualPartyLabel must accept proposerName and recipientName in options',
  );
});
