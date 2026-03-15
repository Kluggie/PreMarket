import assert from 'node:assert/strict';
import test from 'node:test';
import { formatRecipientLabel, formatRecipientShort } from '../../src/lib/recipientUtils.js';

// ─────────────────────────────────────────────────────────────────────────────
//  formatRecipientLabel
// ─────────────────────────────────────────────────────────────────────────────

test('formatRecipientLabel: name + email returns combined label', () => {
  const result = formatRecipientLabel('Sarah Chen', 'sarah@company.com');
  assert.equal(result, 'With: Sarah Chen · sarah@company.com');
});

test('formatRecipientLabel: name only returns name label', () => {
  const result = formatRecipientLabel('Sarah Chen', '');
  assert.equal(result, 'With: Sarah Chen');
});

test('formatRecipientLabel: email only returns email label', () => {
  const result = formatRecipientLabel('', 'sarah@company.com');
  assert.equal(result, 'With: sarah@company.com');
});

test('formatRecipientLabel: neither returns fallback', () => {
  const result = formatRecipientLabel('', '');
  assert.equal(result, 'With: Not specified');
});

test('formatRecipientLabel: null inputs returns fallback', () => {
  const result = formatRecipientLabel(null, null);
  assert.equal(result, 'With: Not specified');
});

test('formatRecipientLabel: undefined inputs returns fallback', () => {
  const result = formatRecipientLabel(undefined, undefined);
  assert.equal(result, 'With: Not specified');
});

test('formatRecipientLabel: whitespace-only inputs returns fallback', () => {
  const result = formatRecipientLabel('   ', '  ');
  assert.equal(result, 'With: Not specified');
});

// ─────────────────────────────────────────────────────────────────────────────
//  formatRecipientShort
// ─────────────────────────────────────────────────────────────────────────────

test('formatRecipientShort: name + email returns combined short label', () => {
  const result = formatRecipientShort('Sarah Chen', 'sarah@company.com');
  assert.equal(result, 'Sarah Chen · sarah@company.com');
});

test('formatRecipientShort: name only returns name', () => {
  const result = formatRecipientShort('Sarah Chen', null);
  assert.equal(result, 'Sarah Chen');
});

test('formatRecipientShort: email only returns email', () => {
  const result = formatRecipientShort(null, 'sarah@company.com');
  assert.equal(result, 'sarah@company.com');
});

test('formatRecipientShort: neither returns Not specified', () => {
  const result = formatRecipientShort(null, null);
  assert.equal(result, 'Not specified');
});

test('formatRecipientShort: whitespace name with email returns email only', () => {
  const result = formatRecipientShort('   ', 'sarah@company.com');
  assert.equal(result, 'sarah@company.com');
});
