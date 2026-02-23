import test from 'node:test';
import assert from 'node:assert/strict';
import { isTipTapDocJson, normalizeEditorContent } from '../../src/components/document-comparison/editorContent.js';

test('editor content guard accepts valid tiptap docs only', () => {
  assert.equal(isTipTapDocJson({ type: 'doc', content: [] }), true);
  assert.equal(isTipTapDocJson({ type: 'paragraph', content: [] }), false);
  assert.equal(isTipTapDocJson({ type: 'doc' }), false);
  assert.equal(isTipTapDocJson({}), false);
  assert.equal(isTipTapDocJson(null), false);
});

test('editor content normalization falls back to safe empty paragraph', () => {
  const validDoc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] };
  assert.deepEqual(normalizeEditorContent(validDoc), validDoc);
  assert.equal(normalizeEditorContent('<p>hello</p>'), '<p>hello</p>');
  assert.equal(normalizeEditorContent(''), '<p></p>');
  assert.equal(normalizeEditorContent(undefined), '<p></p>');
  assert.equal(normalizeEditorContent({}), '<p></p>');
});
