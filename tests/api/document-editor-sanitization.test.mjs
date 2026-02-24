import test from 'node:test';
import assert from 'node:assert/strict';
import {
  htmlToEditorText,
  sanitizeEditorHtml,
  sanitizeEditorText,
  textToEditorHtml,
} from '../../server/_lib/document-editor-sanitization.ts';

test('sanitizeEditorHtml strips unsafe tags and attributes', () => {
  const input = `
    <p onclick="alert(1)">Safe text</p>
    <script>alert('x')</script>
    <img src="x" onerror="alert(1)" />
    <a href="javascript:alert(2)">bad</a>
    <a href="https://example.com" style="font-size: 30px; color: #ff0000;">good</a>
  `;

  const sanitized = sanitizeEditorHtml(input);
  assert.equal(sanitized.includes('<script'), false);
  assert.equal(sanitized.includes('onclick='), false);
  assert.equal(sanitized.includes('onerror='), false);
  assert.equal(sanitized.includes('javascript:'), false);
  assert.equal(sanitized.includes('href="https://example.com"'), true);
  assert.equal(sanitized.includes('font-size'), false);
  assert.equal(sanitized.includes('color:#ff0000'), true);
});

test('sanitizeEditorHtml keeps supported rich formatting', () => {
  const input = `
    <h2>Heading</h2>
    <ul><li>One</li><li>Two</li></ul>
    <table><tr><th>A</th><td>B</td></tr></table>
    <blockquote>Note</blockquote>
  `;
  const sanitized = sanitizeEditorHtml(input);

  assert.equal(sanitized.includes('<h2>Heading</h2>'), true);
  assert.equal(sanitized.includes('<ul>'), true);
  assert.equal(sanitized.includes('<table>'), true);
  assert.equal(sanitized.includes('<blockquote>'), true);
});

test('text/html conversions normalize plain text safely', () => {
  const text = sanitizeEditorText('  hello\r\n\u0000world   ');
  assert.equal(text, 'hello\nworld');

  const html = textToEditorHtml('line 1\n\nline 2');
  assert.equal(html.includes('<p>line 1</p>'), true);
  assert.equal(html.includes('<p>line 2</p>'), true);

  const extractedText = htmlToEditorText('<p>Alpha</p><script>bad</script><p>Beta</p>');
  assert.equal(extractedText.includes('bad'), false);
  assert.equal(extractedText.includes('Alpha'), true);
  assert.equal(extractedText.includes('Beta'), true);
});
