import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';

type DOMPurifyWindow = Parameters<typeof createDOMPurify>[0];

const sanitizationWindow = new JSDOM('').window as unknown as DOMPurifyWindow;
const DOMPurify = createDOMPurify(sanitizationWindow);

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
const COLOR_VALUE_PATTERN =
  /^(#[0-9a-f]{3,8}|rgb\((\s*\d+\s*,){2}\s*\d+\s*\)|rgba\((\s*\d+\s*,){3}\s*(0(\.\d+)?|1(\.0+)?)\s*\)|hsl\((\s*\d+\s*,){2}\s*\d+%?\s*\)|hsla\((\s*\d+\s*,){2}\s*\d+%?\s*,\s*(0(\.\d+)?|1(\.0+)?)\s*\))$/i;
const SAFE_LINK_SCHEME_PATTERN = /^(https?:|mailto:|\/|#)/i;
const SAFE_IMAGE_SCHEME_PATTERN = /^(https?:|blob:)/i;

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

function sanitizeAttributes(element: Element) {
  const tagName = element.tagName.toLowerCase();
  const attrs = [...element.attributes];

  attrs.forEach((attr) => {
    const name = attr.name.toLowerCase();
    const value = attr.value;

    if (name.startsWith('on')) {
      element.removeAttribute(attr.name);
      return;
    }

    if (!ALLOWED_EDITOR_ATTRS.includes(name)) {
      element.removeAttribute(attr.name);
      return;
    }

    if (name === 'style') {
      const style = sanitizeStyleValue(value);
      if (style) {
        element.setAttribute('style', style);
      } else {
        element.removeAttribute('style');
      }
      return;
    }

    if (name === 'href') {
      const safe = sanitizeUrl(value, 'link');
      if (!safe || tagName !== 'a') {
        element.removeAttribute('href');
        return;
      }
      element.setAttribute('href', safe);
      element.setAttribute('target', '_blank');
      element.setAttribute('rel', 'noopener noreferrer nofollow');
      return;
    }

    if (name === 'src') {
      const safe = sanitizeUrl(value, 'image');
      if (!safe || tagName !== 'img') {
        element.removeAttribute('src');
        return;
      }
      element.setAttribute('src', safe);
      return;
    }

    if (name === 'type') {
      if (tagName !== 'input' || value.toLowerCase() !== 'checkbox') {
        element.removeAttribute('type');
      }
      return;
    }

    if (name === 'checked') {
      if (tagName === 'input') {
        element.setAttribute('checked', '');
      } else {
        element.removeAttribute('checked');
      }
      return;
    }

    if (name === 'data-type') {
      const normalized = value.trim();
      const validTaskList =
        (tagName === 'ul' && normalized === 'taskList') ||
        (tagName === 'li' && normalized === 'taskItem');
      if (!validTaskList) {
        element.removeAttribute('data-type');
      }
      return;
    }

    if (name === 'colspan' || name === 'rowspan') {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric < 1 || numeric > 20 || !['td', 'th'].includes(tagName)) {
        element.removeAttribute(name);
      } else {
        element.setAttribute(name, String(Math.floor(numeric)));
      }
      return;
    }

    if (name === 'target' || name === 'rel') {
      if (tagName !== 'a') {
        element.removeAttribute(name);
      }
      return;
    }

    if ((name === 'alt' || name === 'title') && tagName === 'img') {
      const trimmed = sanitizeEditorText(value).slice(0, 300);
      if (trimmed) {
        element.setAttribute(name, trimmed);
      } else {
        element.removeAttribute(name);
      }
      return;
    }

    if (['alt', 'title'].includes(name) && tagName !== 'img') {
      element.removeAttribute(name);
    }
  });
}

function normalizeDocumentHtml(html: string) {
  const dom = new JSDOM(`<body>${html}</body>`);
  const { document } = dom.window;

  document.querySelectorAll('script, style, iframe, object, embed').forEach((node) => node.remove());
  document.querySelectorAll('*').forEach((node) => sanitizeAttributes(node));

  document.querySelectorAll('a').forEach((node) => {
    if (!node.getAttribute('href')) {
      node.replaceWith(...node.childNodes);
    }
  });

  document.querySelectorAll('img').forEach((node) => {
    if (!node.getAttribute('src')) {
      node.remove();
    }
  });

  document.querySelectorAll('span').forEach((node) => {
    if (!node.attributes.length) {
      node.replaceWith(...node.childNodes);
    }
  });

  const normalized = document.body.innerHTML
    .replace(/\u0000/g, '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return normalized || '<p></p>';
}

export function sanitizeEditorHtml(value: unknown) {
  const raw = asString(value);
  if (!raw.trim()) {
    return '<p></p>';
  }

  const domPurified = DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: ALLOWED_EDITOR_TAGS,
    ALLOWED_ATTR: ALLOWED_EDITOR_ATTRS,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math'],
    KEEP_CONTENT: true,
  }) as string;

  return normalizeDocumentHtml(domPurified);
}

export function htmlToEditorText(value: unknown) {
  const sanitizedHtml = sanitizeEditorHtml(value);
  const dom = new JSDOM(`<body>${sanitizedHtml}</body>`);
  const text = dom.window.document.body.textContent || '';
  return sanitizeEditorText(
    text
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n'),
  );
}
