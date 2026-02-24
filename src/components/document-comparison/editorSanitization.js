import DOMPurify from 'dompurify';

const ALLOWED_TAGS = [
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

const ALLOWED_ATTR = [
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

function sanitizeUrl(url, mode) {
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

function sanitizeStyleValue(style) {
  const entries = String(style || '')
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!entries.length) {
    return '';
  }

  const cleaned = [];
  entries.forEach((entry) => {
    const [rawProperty, ...rawValueParts] = entry.split(':');
    const property = String(rawProperty || '').trim().toLowerCase();
    const value = rawValueParts.join(':').trim();
    if (!property || !value || !ALLOWED_STYLE_PROPS.has(property)) {
      return;
    }

    if (property === 'text-align') {
      const align = value.toLowerCase();
      if (ALLOWED_TEXT_ALIGN.has(align)) {
        cleaned.push(`${property}:${align}`);
      }
      return;
    }

    if (COLOR_VALUE_PATTERN.test(value)) {
      cleaned.push(`${property}:${value}`);
    }
  });

  return cleaned.join(';');
}

function sanitizeAttributes(element) {
  const tagName = element.tagName.toLowerCase();
  [...element.attributes].forEach((attribute) => {
    const name = attribute.name.toLowerCase();
    const value = attribute.value;

    if (name.startsWith('on') || !ALLOWED_ATTR.includes(name)) {
      element.removeAttribute(attribute.name);
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
      const safeHref = sanitizeUrl(value, 'link');
      if (tagName !== 'a' || !safeHref) {
        element.removeAttribute('href');
        return;
      }
      element.setAttribute('href', safeHref);
      element.setAttribute('target', '_blank');
      element.setAttribute('rel', 'noopener noreferrer nofollow');
      return;
    }

    if (name === 'src') {
      const safeSrc = sanitizeUrl(value, 'image');
      if (tagName !== 'img' || !safeSrc) {
        element.removeAttribute('src');
        return;
      }
      element.setAttribute('src', safeSrc);
      return;
    }

    if (name === 'data-type') {
      const normalized = value.trim();
      const validTaskType =
        (tagName === 'ul' && normalized === 'taskList') ||
        (tagName === 'li' && normalized === 'taskItem');
      if (!validTaskType) {
        element.removeAttribute('data-type');
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

    if (name === 'type') {
      if (tagName !== 'input' || value.toLowerCase() !== 'checkbox') {
        element.removeAttribute('type');
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

    if ((name === 'target' || name === 'rel') && tagName !== 'a') {
      element.removeAttribute(name);
      return;
    }

    if ((name === 'alt' || name === 'title') && tagName === 'img') {
      const trimmed = String(value || '')
        .replace(/\u0000/g, '')
        .trim()
        .slice(0, 300);
      if (trimmed) {
        element.setAttribute(name, trimmed);
      } else {
        element.removeAttribute(name);
      }
      return;
    }

    if ((name === 'alt' || name === 'title') && tagName !== 'img') {
      element.removeAttribute(name);
    }
  });
}

function normalizeGoogleDocsHtml(html) {
  return String(html || '')
    .replace(/<o:p>\s*<\/o:p>/gi, '')
    .replace(/<o:p>.*?<\/o:p>/gi, '&nbsp;')
    .replace(/\sclass=(\"|\').*?\1/gi, '')
    .replace(/\sid=(\"|\').*?\1/gi, '')
    .replace(/\sstyle=(\"|\')(?![^\"']*(color|background-color|text-align)).*?\1/gi, '');
}

function postProcessSanitizedHtml(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${html}</body>`, 'text/html');

  doc.querySelectorAll('*').forEach((element) => sanitizeAttributes(element));
  doc.querySelectorAll('script, style, iframe, object, embed').forEach((node) => node.remove());

  doc.querySelectorAll('a').forEach((node) => {
    if (!node.getAttribute('href')) {
      node.replaceWith(...node.childNodes);
    }
  });

  doc.querySelectorAll('img').forEach((node) => {
    if (!node.getAttribute('src')) {
      node.remove();
    }
  });

  doc.querySelectorAll('span').forEach((node) => {
    if (!node.attributes.length) {
      node.replaceWith(...node.childNodes);
    }
  });

  const normalized = doc.body.innerHTML
    .replace(/\u0000/g, '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return normalized || '<p></p>';
}

export function sanitizeEditorHtml(value) {
  const rawHtml = String(value || '');
  if (!rawHtml.trim()) {
    return '<p></p>';
  }

  const cleanedDocsHtml = normalizeGoogleDocsHtml(rawHtml);
  const sanitized = DOMPurify.sanitize(cleanedDocsHtml, {
    ALLOWED_TAGS: ALLOWED_TAGS,
    ALLOWED_ATTR: ALLOWED_ATTR,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math'],
    KEEP_CONTENT: true,
  });

  return postProcessSanitizedHtml(String(sanitized || ''));
}

export function sanitizePastedHtml(value) {
  return sanitizeEditorHtml(value);
}

export function sanitizePastedText(value) {
  const normalized = String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();

  return normalized;
}
