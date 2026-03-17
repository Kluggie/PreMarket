/**
 * tests/lib/guest-draft.test.mjs
 *
 * Unit tests for guest draft localStorage persistence schema and migration helpers.
 *
 * These tests run in Node.js (without a DOM) and validate the data structures
 * used by the GuestCreateOpportunity page and post-auth migration logic.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

// ── Helpers matching the logic in useGuestDraft.js ────────────────────────────

const DRAFT_VERSION = 1;
const GUEST_DRAFT_KEY = 'pm:guest_draft';

/** Must match DRAFT_MAX_AGE_MS exported from useGuestDraft.js */
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function readLocalDraft(store) {
  const raw = store[GUEST_DRAFT_KEY];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed._v && parsed._v !== DRAFT_VERSION) return null;
    // Expiry guard — must match useGuestDraft.js
    if (parsed.savedAt) {
      const age = Date.now() - new Date(parsed.savedAt).getTime();
      if (age > DRAFT_MAX_AGE_MS) {
        delete store[GUEST_DRAFT_KEY];
        return null;
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeLocalDraft(store, draft) {
  store[GUEST_DRAFT_KEY] = JSON.stringify({ ...draft, _v: DRAFT_VERSION });
}

// ── Response row builder (matches GuestCreateOpportunity logic) ───────────────

function normalizeVisibilitySetting(value) {
  const v = String(value || '').trim().toLowerCase();
  return ['hidden', 'not_shared', 'private', 'confidential', 'partial'].includes(v) ? 'hidden' : 'full';
}

function serializeResponseValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function buildMigrationResponseRows(savedResponses, savedVisibility, questions) {
  const templateQuestionsById = new Map(questions.map((q) => [q.id, q]));
  return Object.entries(savedResponses)
    .filter(([key]) => !key.startsWith('_'))
    .map(([key, value]) => {
      const [questionId, suffix] = key.includes('__') ? key.split('__') : [key, 'a'];
      const question = templateQuestionsById.get(questionId);
      if (!question) return null;
      const enteredByParty = suffix === 'b' ? 'b' : 'a';
      const roleType = question?.role_type || 'party_attribute';
      const claimType =
        roleType === 'shared_fact' ? 'shared_fact' : enteredByParty === 'b' ? 'counterparty_claim' : 'self';
      const row = {
        question_id: questionId,
        section_id: question.section_id || null,
        value: serializeResponseValue(value),
        value_type: 'text',
        range_min: null,
        range_max: null,
        visibility:
          enteredByParty === 'b' || roleType === 'shared_fact'
            ? 'full'
            : normalizeVisibilitySetting(
                savedVisibility[key] || savedVisibility[questionId] || question.visibility_default,
              ),
        claim_type: claimType,
        entered_by_party: enteredByParty,
      };
      if (value && typeof value === 'object' && value.type === 'range') {
        row.value = null;
        row.value_type = 'range';
        row.range_min = String(value.min || '');
        row.range_max = String(value.max || '');
      }
      return row;
    })
    .filter(Boolean);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('writeLocalDraft stores draft with version tag', () => {
  const store = {};
  writeLocalDraft(store, { templateSlug: 'universal_m_and_a_prequal', step: 2 });
  const raw = JSON.parse(store[GUEST_DRAFT_KEY]);
  assert.equal(raw._v, DRAFT_VERSION, 'Version tag should be present');
  assert.equal(raw.templateSlug, 'universal_m_and_a_prequal');
  assert.equal(raw.step, 2);
});

test('readLocalDraft returns null when store is empty', () => {
  assert.equal(readLocalDraft({}), null);
});

test('readLocalDraft returns draft when valid', () => {
  const store = {};
  writeLocalDraft(store, { templateSlug: 'test_template', step: 1, recipientEmail: 'a@b.com' });
  const draft = readLocalDraft(store);
  assert.ok(draft, 'Should return a non-null draft');
  assert.equal(draft.templateSlug, 'test_template');
  assert.equal(draft.recipientEmail, 'a@b.com');
});

test('readLocalDraft ignores drafts with incompatible version', () => {
  const store = {};
  store[GUEST_DRAFT_KEY] = JSON.stringify({ _v: 99, templateSlug: 'old_template' });
  const draft = readLocalDraft(store);
  assert.equal(draft, null, 'Incompatible version should yield null');
});

test('readLocalDraft handles malformed JSON gracefully', () => {
  const store = { [GUEST_DRAFT_KEY]: 'not-valid-json{{{' };
  const draft = readLocalDraft(store);
  assert.equal(draft, null, 'Malformed JSON should yield null');
});

test('buildMigrationResponseRows converts party A responses correctly', () => {
  const questions = [
    { id: 'company_name', section_id: 'org', role_type: 'party_attribute', visibility_default: 'full' },
    { id: 'company_size', section_id: 'org', role_type: 'party_attribute', visibility_default: 'hidden' },
  ];
  const responses = { company_name: 'Acme Corp', company_size: '100-500' };
  const visibility = { company_name: 'full', company_size: 'hidden' };

  const rows = buildMigrationResponseRows(responses, visibility, questions);
  assert.equal(rows.length, 2);

  const nameRow = rows.find((r) => r.question_id === 'company_name');
  assert.equal(nameRow.value, 'Acme Corp');
  assert.equal(nameRow.entered_by_party, 'a');
  assert.equal(nameRow.visibility, 'full');
  assert.equal(nameRow.claim_type, 'self');

  const sizeRow = rows.find((r) => r.question_id === 'company_size');
  assert.equal(sizeRow.visibility, 'hidden');
});

test('buildMigrationResponseRows handles __b suffix for party B responses', () => {
  const questions = [
    { id: 'revenue', section_id: 'fin', role_type: 'party_attribute', visibility_default: 'full' },
  ];
  const responses = { 'revenue__b': '$5M' };
  const rows = buildMigrationResponseRows(responses, {}, questions);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].question_id, 'revenue');
  assert.equal(rows[0].entered_by_party, 'b');
  assert.equal(rows[0].claim_type, 'counterparty_claim');
  assert.equal(rows[0].visibility, 'full'); // counterparty always full
});

test('buildMigrationResponseRows handles range values correctly', () => {
  const questions = [
    { id: 'deal_size', section_id: 'deal', role_type: 'party_attribute', visibility_default: 'full' },
  ];
  const responses = { deal_size: { type: 'range', min: '1000000', max: '5000000' } };
  const rows = buildMigrationResponseRows(responses, {}, questions);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].value_type, 'range');
  assert.equal(rows[0].value, null);
  assert.equal(rows[0].range_min, '1000000');
  assert.equal(rows[0].range_max, '5000000');
});

test('buildMigrationResponseRows skips keys starting with underscore', () => {
  const questions = [
    { id: 'company_name', section_id: 'org', role_type: 'party_attribute', visibility_default: 'full' },
  ];
  const responses = { company_name: 'Acme', _profile_url: 'https://example.com' };
  const rows = buildMigrationResponseRows(responses, {}, questions);
  const keys = rows.map((r) => r.question_id);
  assert.ok(!keys.includes('_profile_url'), 'Private keys should be excluded');
  assert.ok(keys.includes('company_name'));
});

test('buildMigrationResponseRows skips questions not in template', () => {
  const questions = [
    { id: 'known_field', section_id: 'org', role_type: 'party_attribute', visibility_default: 'full' },
  ];
  const responses = { known_field: 'value', unknown_field: 'should be skipped' };
  const rows = buildMigrationResponseRows(responses, {}, questions);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].question_id, 'known_field');
});

test('normalizeVisibilitySetting maps hidden variants correctly', () => {
  const hiddenInputs = ['hidden', 'not_shared', 'private', 'confidential', 'partial'];
  for (const input of hiddenInputs) {
    assert.equal(normalizeVisibilitySetting(input), 'hidden', `Should map "${input}" to "hidden"`);
  }
  assert.equal(normalizeVisibilitySetting('full'), 'full');
  assert.equal(normalizeVisibilitySetting('visible'), 'full');
  assert.equal(normalizeVisibilitySetting(''), 'full');
  assert.equal(normalizeVisibilitySetting(null), 'full');
  assert.equal(normalizeVisibilitySetting(undefined), 'full');
});

// ── Expiry tests ──────────────────────────────────────────────────────────────

test('readLocalDraft discards a draft older than 7 days', () => {
  const store = {};
  const expired = new Date(Date.now() - DRAFT_MAX_AGE_MS - 1000).toISOString();
  store[GUEST_DRAFT_KEY] = JSON.stringify({
    _v: DRAFT_VERSION,
    templateSlug: 'test_template',
    savedAt: expired,
  });
  const result = readLocalDraft(store);
  assert.equal(result, null, 'Expired draft should be discarded');
  assert.ok(!store[GUEST_DRAFT_KEY], 'Expired draft should be removed from store');
});

test('readLocalDraft keeps a draft saved less than 7 days ago', () => {
  const store = {};
  const recent = new Date(Date.now() - 60_000).toISOString(); // 1 minute ago
  store[GUEST_DRAFT_KEY] = JSON.stringify({
    _v: DRAFT_VERSION,
    templateSlug: 'fresh_template',
    savedAt: recent,
  });
  const result = readLocalDraft(store);
  assert.ok(result, 'Recent draft should not be discarded');
  assert.equal(result.templateSlug, 'fresh_template');
});

test('readLocalDraft keeps a draft saved exactly at the 7-day boundary minus 1s', () => {
  const store = {};
  const almostExpired = new Date(Date.now() - DRAFT_MAX_AGE_MS + 1000).toISOString();
  store[GUEST_DRAFT_KEY] = JSON.stringify({
    _v: DRAFT_VERSION,
    templateSlug: 'boundary_template',
    savedAt: almostExpired,
  });
  const result = readLocalDraft(store);
  assert.ok(result, 'Draft still within 7-day window should survive');
});

test('readLocalDraft treats a draft with no savedAt as non-expired (for legacy compat)', () => {
  const store = {};
  store[GUEST_DRAFT_KEY] = JSON.stringify({
    _v: DRAFT_VERSION,
    templateSlug: 'legacy_template',
    // no savedAt
  });
  const result = readLocalDraft(store);
  assert.ok(result, 'Draft without savedAt should not be discarded (legacy)');
});
