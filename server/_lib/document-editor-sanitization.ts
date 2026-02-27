type SanitizedAttributeValue = string | true;

const ALLOWED_EDITOR_TAGS = [
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'h1',
  'h2',
  'h3',
  'ul',
  'ol',
  'li',
  'blockquote',
  'table',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
  'a',
  'img',
  'hr',
  'code',
  'pre',
  'sub',
  'sup',
  'span',
  'label',
  'input',
  'div',
];

const ALLOWED_EDITOR_ATTRS = [
  'href',
  'target',
  'rel',
  'src',
  'alt',
  'title',
  'style',
  'colspan',
  'rowspan',
  'checked',
  'type',
  'data-type',
];

const ALLOWED_TEXT_ALIGN = new Set(['left', 'center', 'right', 'justify']);
const ALLOWED_STYLE_PROPS = new Set(['color', 'background-color', 'text-align']);
const VOID_EDITOR_TAGS = new Set(['br', 'img', 'hr', 'input']);
const COLOR_VALUE_PATTERN =
  /^(#[0-9a-f]{3,8}|rgb\((\s*\d+\s*,){2}\s*\d+\s*\)|rgba\((\s*\d+\s*,){3}\s*(0(\.\d+)?|1(\.0+)?)\s*\)|hsl\((\s*\d+\s*,){2}\s*\d+%?\s*\)|hsla\((\s*\d+\s*,){2}\s*\d+%?\s*,\s*(0(\.\d+)?|1(\.0+)?)\s*\))$/i;
const SAFE_LINK_SCHEME_PATTERN = /^(https?:|mailto:|\/|#)/i;
const SAFE_IMAGE_SCHEME_PATTERN = /^(https?:|blob:)/i;
const FORBIDDEN_TAG_BLOCK_PATTERN =
  /<\s*(script|style|iframe|object|embed|svg|math)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
const FORBIDDEN_SELF_CLOSING_TAG_PATTERN =
  /<\s*(script|style|iframe|object|embed|svg|math)\b[^>]*\/\s*>/gi;
const HTML_TAG_PATTERN = /<\/?([a-zA-Z][\w:-]*)([^<>]*)>/g;
const HTML_ATTR_PATTERN = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g;
const HTML_ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
};
const TEXT_BREAK_CLOSE_TAG_PATTERN =
  /<\/\s*(p|div|h1|h2|h3|li|blockquote|pre|tr|table|ul|ol)\s*>/gi;
const TEXT_BREAK_BR_PATTERN = /<\s*br\s*\/?>/gi;
const TEXT_CELL_BREAK_PATTERN = /<\/\s*(td|th)\s*>/gi;

function asString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

export function sanitizeEditorText(value: unknown) {
  return asString(value)
    .replace(/\u0000/g, '')
    .replace(/\r/g, '')
    .replace(/[^\S\n\t]{2,}/g, ' ')
    .trim();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseTagAttributes(rawAttrs: string) {
  const attributes: Array<{ name: string; value: string }> = [];
  const source = String(rawAttrs || '');
  let match: RegExpExecArray | null;

  while ((match = HTML_ATTR_PATTERN.exec(source))) {
    const rawName = String(match[1] || '').trim();
    if (!rawName) {
      continue;
    }
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    attributes.push({
      name: rawName.toLowerCase(),
      value: String(value || ''),
    });
  }

  return attributes;
}

function buildSanitizedAttributes(tagName: string, rawAttrs: string): Map<string, SanitizedAttributeValue> {
  const attrs = new Map<string, SanitizedAttributeValue>();

  for (const attr of parseTagAttributes(rawAttrs)) {
    const name = attr.name;
    const value = attr.value;

    if (name.startsWith('on')) {
      continue;
    }

    if (!ALLOWED_EDITOR_ATTRS.includes(name)) {
      continue;
    }

    if (name === 'style') {
      const style = sanitizeStyleValue(value);
      if (style) {
        attrs.set('style', style);
      }
      continue;
    }

    if (name === 'href') {
      if (tagName === 'a') {
        const safeHref = sanitizeUrl(value, 'link');
        if (safeHref) {
          attrs.set('href', safeHref);
        }
      }
      continue;
    }

    if (name === 'src') {
      if (tagName === 'img') {
        const safeSrc = sanitizeUrl(value, 'image');
        if (safeSrc) {
          attrs.set('src', safeSrc);
        }
      }
      continue;
    }

    if (name === 'type') {
      if (tagName === 'input' && value.toLowerCase() === 'checkbox') {
        attrs.set('type', 'checkbox');
      }
      continue;
    }

    if (name === 'checked') {
      if (tagName === 'input') {
        attrs.set('checked', true);
      }
      continue;
    }

    if (name === 'data-type') {
      const normalized = value.trim();
      const validTaskList =
        (tagName === 'ul' && normalized === 'taskList') ||
        (tagName === 'li' && normalized === 'taskItem');
      if (validTaskList) {
        attrs.set('data-type', normalized);
      }
      continue;
    }

    if (name === 'colspan' || name === 'rowspan') {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric >= 1 && numeric <= 20 && ['td', 'th'].includes(tagName)) {
        attrs.set(name, String(Math.floor(numeric)));
      }
      continue;
    }

    if (name === 'target' || name === 'rel') {
      if (tagName === 'a') {
        attrs.set(name, value.trim());
      }
      continue;
    }

    if (name === 'alt' || name === 'title') {
      if (tagName === 'img') {
        const trimmed = sanitizeEditorText(value).slice(0, 300);
        if (trimmed) {
          attrs.set(name, trimmed);
        }
      }
    }
  }

  if (tagName === 'a') {
    if (attrs.has('href')) {
      attrs.set('target', '_blank');
      attrs.set('rel', 'noopener noreferrer nofollow');
    } else {
      attrs.delete('target');
      attrs.delete('rel');
    }
  } else {
    attrs.delete('href');
    attrs.delete('target');
    attrs.delete('rel');
  }

  if (tagName === 'img') {
    if (!attrs.has('src')) {
      return new Map();
    }
  } else {
    attrs.delete('src');
    attrs.delete('alt');
    attrs.delete('title');
  }

  if (tagName === 'input') {
    if (attrs.get('type') !== 'checkbox') {
      attrs.delete('type');
      attrs.delete('checked');
    }
  } else {
    attrs.delete('type');
    attrs.delete('checked');
  }

  if (tagName !== 'ul' && tagName !== 'li') {
    attrs.delete('data-type');
  }

  return attrs;
}

function serializeAttributes(attributes: Map<string, SanitizedAttributeValue>) {
  if (attributes.size === 0) {
    return '';
  }

  const parts: string[] = [];
  for (const [name, value] of attributes.entries()) {
    if (value === true) {
      parts.push(name);
      continue;
    }
    parts.push(`${name}="${escapeHtml(String(value || ''))}"`);
  }

  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

function sanitizeTags(html: string) {
  return html.replace(HTML_TAG_PATTERN, (fullMatch, rawTagName: string, rawAttrs: string) => {
    const tagName = String(rawTagName || '').toLowerCase();
    if (!ALLOWED_EDITOR_TAGS.includes(tagName)) {
      return '';
    }

    const isClosingTag = /^<\s*\//.test(fullMatch);
    if (isClosingTag) {
      if (VOID_EDITOR_TAGS.has(tagName)) {
        return '';
      }
      return `</${tagName}>`;
    }

    const attributes = buildSanitizedAttributes(tagName, rawAttrs || '');
    if (tagName === 'img' && !attributes.has('src')) {
      return '';
    }

    const serialized = serializeAttributes(attributes);
    if (VOID_EDITOR_TAGS.has(tagName)) {
      return `<${tagName}${serialized}/>`;
    }
    return `<${tagName}${serialized}>`;
  });
}

function decodeHtmlEntities(value: string) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_match, numericValue) => {
      const codePoint = Number(numericValue);
      if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
        return '';
      }
      return String.fromCodePoint(codePoint);
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, hexValue) => {
      const codePoint = Number.parseInt(hexValue, 16);
      if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
        return '';
      }
      return String.fromCodePoint(codePoint);
    })
    .replace(/&([a-z0-9#]+);/gi, (match, entityName) => {
      const key = String(entityName || '').toLowerCase();
      return Object.prototype.hasOwnProperty.call(HTML_ENTITY_MAP, key) ? HTML_ENTITY_MAP[key] : match;
    });
}

export function textToEditorHtml(value: unknown) {
  const normalized = sanitizeEditorText(value);
  if (!normalized) {
    return '<p></p>';
  }

  const paragraphs = normalized.split(/\n{2,}/g).filter(Boolean);
  if (!paragraphs.length) {
    return '<p></p>';
  }

  return paragraphs
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

function sanitizeUrl(url: string, mode: 'link' | 'image') {
  const trimmed = String(url || '').trim();
  if (!trimmed) {
    return '';
  }

  const lower = trimmed.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:')) {
    return '';
  }

  if (mode === 'image') {
    return SAFE_IMAGE_SCHEME_PATTERN.test(trimmed) ? trimmed : '';
  }

  return SAFE_LINK_SCHEME_PATTERN.test(trimmed) ? trimmed : '';
}

function sanitizeStyleValue(style: string) {
  const entries = String(style || '')
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!entries.length) {
    return '';
  }

  const safeEntries: string[] = [];
  for (const entry of entries) {
    const [rawProp, ...rawValueParts] = entry.split(':');
    const property = String(rawProp || '').trim().toLowerCase();
    const value = rawValueParts.join(':').trim();
    if (!property || !value || !ALLOWED_STYLE_PROPS.has(property)) {
      continue;
    }

    if (property === 'text-align') {
      if (ALLOWED_TEXT_ALIGN.has(value.toLowerCase())) {
        safeEntries.push(`${property}:${value.toLowerCase()}`);
      }
      continue;
    }

    if (COLOR_VALUE_PATTERN.test(value)) {
      safeEntries.push(`${property}:${value}`);
    }
  }

  return safeEntries.join(';');
}

function normalizeDocumentHtml(html: string) {
  const withoutForbiddenBlocks = String(html || '')
    .replace(FORBIDDEN_TAG_BLOCK_PATTERN, '')
    .replace(FORBIDDEN_SELF_CLOSING_TAG_PATTERN, '');
  const sanitizedTags = sanitizeTags(withoutForbiddenBlocks);
  const normalized = sanitizedTags
    .replace(/\u0000/g, '')
    .replace(/\r/g, '')
    .replace(/<span>\s*<\/span>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return normalized || '<p></p>';
}

export function sanitizeEditorHtml(value: unknown) {
  const raw = asString(value);
  if (!raw.trim()) {
    return '<p></p>';
  }

  return normalizeDocumentHtml(raw);
}

export function htmlToEditorText(value: unknown) {
  const sanitizedHtml = sanitizeEditorHtml(value);
  const withBreaks = sanitizedHtml
    .replace(TEXT_BREAK_BR_PATTERN, '\n')
    .replace(TEXT_CELL_BREAK_PATTERN, '\t')
    .replace(TEXT_BREAK_CLOSE_TAG_PATTERN, '\n');
  const text = decodeHtmlEntities(withBreaks.replace(/<[^>]*>/g, ' '));
  return sanitizeEditorText(
    text
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n'),
  );
}
