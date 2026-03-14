/**
 * Vertex AI Input Sanitizer
 *
 * Normalizes arbitrary user-supplied text before it is embedded in LLM prompts.
 * Prevents null bytes, harmful C0 control characters, and bare CR line endings
 * from reaching the Vertex AI API or confusing the model.
 *
 * CONTRACT (intentionally narrow):
 *   - Strips only characters that are structurally dangerous in JSON strings
 *     or known to cause Vertex API 400 rejections (null bytes, C0 controls)
 *   - Preserves ALL user-visible content: bullets, markdown, numbered lists,
 *     quotes, apostrophes, braces { }, brackets [ ], backticks, pasted emails,
 *     contract language, multi-line text, mixed formatting
 *   - Does NOT parse user text as JSON
 *   - Does NOT modify evaluation logic, prompt semantics, or output parsing
 *   - Caller is responsible for domain-specific length limits (MAX_SHARED_CHARS etc.)
 *
 * NOT changed by this file:
 *   - Evaluation flow, workflow, step logic, UI flow
 *   - Proposal/document statuses, persistence, data shapes
 *   - Report structure, confidential/shared information handling
 *   - Retry behavior, fallback logic, downstream rendering
 */

// C0 control chars that are unsafe in JSON strings and LLM prompts.
// Kept: \x09 (tab), \x0A (LF newline)
// Removed: \x00 (NUL), \x01-\x08 (SOH–BS), \x0B (VT), \x0C (FF),
//          \x0E-\x1F (SO–US), \x7F (DEL)
// eslint-disable-next-line no-control-regex
const UNSAFE_CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/**
 * Sanitize arbitrary user-supplied text for safe embedding in LLM prompts.
 *
 * Steps (in order):
 *   1. Coerce null/undefined/non-string to empty string
 *   2. Normalize CRLF (\r\n) and bare CR (\r) to LF (\n)
 *   3. Strip null bytes and dangerous C0 control characters
 *   4. Optionally truncate at maxChars with a visible truncation marker
 *
 * Idempotent: calling this on already-sanitized text returns the same text.
 */
export function sanitizeUserInput(value: unknown, options?: { maxChars?: number }): string {
  // Step 1: coerce to string
  let text: string;
  if (value == null) {
    text = '';
  } else if (typeof value === 'string') {
    text = value;
  } else {
    text = String(value);
  }

  // Step 2: normalize line endings
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Step 3: strip null bytes and dangerous C0 control characters
  text = text.replace(UNSAFE_CONTROL_CHAR_RE, '');

  // Step 4: optional safe truncation
  const maxChars = options?.maxChars;
  if (maxChars != null && maxChars > 0 && text.length > maxChars) {
    // Truncate at a word boundary where possible
    let cutAt = maxChars;
    const nearbySpace = text.lastIndexOf(' ', maxChars);
    if (nearbySpace > maxChars * 0.85) {
      cutAt = nearbySpace;
    }
    text = text.slice(0, cutAt) + '\n[USER INPUT TRUNCATED]';
  }

  return text;
}

/**
 * Wrap sanitized user content in XML-style delimiters so the model understands
 * the enclosed text is raw user-supplied data — not prompt instructions.
 *
 * Explicitly documents that the content may contain bullets, markdown,
 * JSON-like braces, numbered lists, quotes, apostrophes, mixed formatting,
 * and pasted documents. The model must treat everything inside as plain text.
 */
export function wrapRawUserContent(tag: string, text: string): string {
  return (
    `<${tag} type="raw_user_text" may_contain="bullets markdown numbered_lists` +
    ` braces brackets quotes apostrophes mixed_formatting pasted_documents">\n` +
    text +
    `\n</${tag}>`
  );
}
