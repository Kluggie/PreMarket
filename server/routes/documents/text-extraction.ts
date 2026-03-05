/**
 * Text extraction for user-uploaded documents.
 *
 * Supported:
 *   PDF   – pdf-parse
 *   DOCX  – mammoth
 *   PPTX  – minimal ZIP reader + DrawingML <a:t> tag extraction
 *   XLSX  – minimal ZIP reader + shared-strings + cell value extraction
 *   TXT / MD – UTF-8 decode
 *
 * All extraction is best-effort; errors return { text: null, supported: true }.
 */

// ---------------------------------------------------------------------------
// Text normalization helpers
// ---------------------------------------------------------------------------
function normalizeText(value: unknown) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\r/g, '')
    .replace(/[\t ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#([0-9]+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)));
}

function extractTextFromHtml(html: string) {
  const withoutScripts = String(html || '')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');
  const withBreaks = withoutScripts
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|h[1-6]|li|tr)>/gi, '\n');
  const stripped = withBreaks.replace(/<[^>]+>/g, ' ');
  return normalizeText(
    stripped
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'"),
  );
}

// ---------------------------------------------------------------------------
// Minimal ZIP reader (no external deps — uses node:zlib inflateRaw)
// Supports Deflate (method=8) and Stored (method=0) entries.
// ---------------------------------------------------------------------------
async function readZipEntries(buf: Buffer): Promise<Map<string, Buffer>> {
  const entries = new Map<string, Buffer>();
  const EOCD_SIG = 0x06054b50;

  // Find End-of-Central-Directory (search from end)
  let eocdOffset = -1;
  for (let i = Math.min(buf.length - 22, buf.length - 1); i >= 0 && i >= buf.length - 65558; i--) {
    if (buf.length - i >= 22 && buf.readUInt32LE(i) === EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) return entries;

  const cdSize = buf.readUInt32LE(eocdOffset + 12);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);

  if (cdOffset + cdSize > buf.length) return entries;

  const { promisify } = await import('node:util');
  const { inflateRaw } = await import('node:zlib');
  const inflate = promisify(inflateRaw);

  let pos = cdOffset;
  const cdEnd = cdOffset + cdSize;

  while (pos < cdEnd - 4) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break; // central directory file header sig

    const compressMethod = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const fileNameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localHeaderOffset = buf.readUInt32LE(pos + 42);
    const entryName = buf.toString('utf8', pos + 46, pos + 46 + fileNameLen);

    pos += 46 + fileNameLen + extraLen + commentLen;

    // Read from local file header
    if (localHeaderOffset + 30 > buf.length) continue;
    if (buf.readUInt32LE(localHeaderOffset) !== 0x04034b50) continue;

    const lhFileNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const lhExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + lhFileNameLen + lhExtraLen;
    const dataEnd = dataStart + compressedSize;

    if (compressedSize === 0 || dataEnd > buf.length) continue;

    const compressed = buf.slice(dataStart, dataEnd);
    try {
      let content: Buffer;
      if (compressMethod === 0) {
        content = compressed;
      } else if (compressMethod === 8) {
        content = (await inflate(compressed)) as Buffer;
      } else {
        continue; // unsupported method
      }
      entries.set(entryName, content);
    } catch {
      // skip unreadable entry
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// PPTX extractor: reads slide XML and pulls <a:t> text elements
// ---------------------------------------------------------------------------
async function extractPptx(buffer: Buffer): Promise<string | null> {
  try {
    const entries = await readZipEntries(buffer);
    if (!entries.size) return null;

    const slideKeys = [...entries.keys()]
      .filter((k) => /^ppt\/slides\/slide\d+\.xml$/i.test(k))
      .sort((a, b) => {
        const na = parseInt(a.replace(/\D/g, '') || '0', 10);
        const nb = parseInt(b.replace(/\D/g, '') || '0', 10);
        return na - nb;
      });

    if (!slideKeys.length) return null;

    const slideTexts: string[] = [];
    for (const key of slideKeys) {
      const xml = entries.get(key)!.toString('utf8');
      const matches = [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)];
      const texts = matches
        .map((m) => decodeXmlEntities(m[1]).trim())
        .filter(Boolean);
      if (texts.length) slideTexts.push(texts.join(' '));
    }

    return normalizeText(slideTexts.join('\n')) || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// XLSX extractor: shared strings + sheet cell values (max 5 sheets, 500 cells each)
// ---------------------------------------------------------------------------
async function extractXlsx(buffer: Buffer): Promise<string | null> {
  try {
    const entries = await readZipEntries(buffer);
    if (!entries.size) return null;

    // Build shared strings index
    const ssXml = entries.get('xl/sharedStrings.xml')?.toString('utf8') || '';
    const sharedStrings = [...ssXml.matchAll(/<t[^>]*>([^<]*)<\/t>/g)]
      .map((m) => decodeXmlEntities(m[1]));

    const sheetKeys = [...entries.keys()]
      .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k))
      .sort((a, b) => {
        const na = parseInt(a.replace(/\D/g, '') || '0', 10);
        const nb = parseInt(b.replace(/\D/g, '') || '0', 10);
        return na - nb;
      })
      .slice(0, 5); // max 5 sheets

    if (!sheetKeys.length) return null;

    const allRows: string[] = [];
    for (const key of sheetKeys) {
      const xml = entries.get(key)!.toString('utf8');
      const rowTexts: string[] = [];
      let cellCount = 0;

      // Shared-string references: <c r="A1" t="s"><v>42</v></c>
      for (const m of xml.matchAll(/<c\b[^>]*\bt="s"[^>]*><v>(\d+)<\/v><\/c>/g)) {
        if (cellCount++ > 500) break;
        const idx = parseInt(m[1], 10);
        if (!isNaN(idx) && sharedStrings[idx]) {
          rowTexts.push(sharedStrings[idx].trim());
        }
      }

      // Inline strings: <is><t>text</t></is>
      for (const m of xml.matchAll(/<is><t>([^<]*)<\/t><\/is>/g)) {
        if (cellCount++ > 500) break;
        const text = decodeXmlEntities(m[1]).trim();
        if (text) rowTexts.push(text);
      }

      // Numeric/formula cells (value only, no shared string): <c r="B2"><v>42</v></c>
      for (const m of xml.matchAll(/<c\b(?![^>]*\bt=)[^>]*><v>([^<]+)<\/v><\/c>/g)) {
        if (cellCount++ > 500) break;
        const val = m[1].trim();
        if (val) rowTexts.push(val);
      }

      if (rowTexts.length) allRows.push(rowTexts.join(' | '));
    }

    return normalizeText(allRows.join('\n')) || null;
  } catch {
    return null;
  }
}

type ExtractionReason = 'unsupported_type' | 'no_text_found' | 'encrypted_pdf' | 'extraction_failed';

type InternalExtractionResult = {
  text: string | null;
  reason: ExtractionReason | null;
  errorMessage: string | null;
};

function classifyPdfError(error: unknown): ExtractionReason {
  const message = String((error as any)?.message || error || '').toLowerCase();
  if (
    message.includes('encrypted') ||
    message.includes('password') ||
    message.includes('decrypt')
  ) {
    return 'encrypted_pdf';
  }
  return 'extraction_failed';
}

// ---------------------------------------------------------------------------
// PDF extractor
// ---------------------------------------------------------------------------
async function extractPdf(buffer: Buffer): Promise<InternalExtractionResult> {
  try {
    const module: any = await import('pdf-parse');
    const PDFParse = module?.PDFParse;

    if (typeof PDFParse === 'function') {
      const parser = new PDFParse({ data: buffer });
      try {
        const parsed = await parser.getText();
        const text = normalizeText(parsed?.text);
        if (!text) {
          return {
            text: null,
            reason: 'no_text_found',
            errorMessage: 'No text found in PDF',
          };
        }
        return { text, reason: null, errorMessage: null };
      } catch (error: any) {
        const reason = classifyPdfError(error);
        return {
          text: null,
          reason,
          errorMessage:
            reason === 'encrypted_pdf'
              ? 'PDF is encrypted and cannot be processed'
              : String(error?.message || 'PDF extraction failed').slice(0, 500),
        };
      } finally {
        await parser.destroy().catch(() => null);
      }
    }

    const fallbackParse = module?.default || module;
    if (typeof fallbackParse === 'function') {
      const result = await fallbackParse(buffer);
      const text = normalizeText(result?.text);
      if (!text) {
        return {
          text: null,
          reason: 'no_text_found',
          errorMessage: 'No text found in PDF',
        };
      }
      return { text, reason: null, errorMessage: null };
    }

    return {
      text: null,
      reason: 'extraction_failed',
      errorMessage: 'PDF extraction dependency is unavailable',
    };
  } catch (error: any) {
    const reason = classifyPdfError(error);
    return {
      text: null,
      reason,
      errorMessage:
        reason === 'encrypted_pdf'
          ? 'PDF is encrypted and cannot be processed'
          : String(error?.message || 'PDF extraction failed').slice(0, 500),
    };
  }
}

// ---------------------------------------------------------------------------
// DOCX extractor (mammoth)
// ---------------------------------------------------------------------------
async function extractDocx(buffer: Buffer): Promise<string | null> {
  try {
    const mammothModule: any = await import('mammoth');
    const mammoth = mammothModule?.default || mammothModule;
    const result = await mammoth.convertToHtml({ buffer });
    const html = String(result?.value || '').trim();
    return extractTextFromHtml(html) || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Plain text / Markdown
// ---------------------------------------------------------------------------
function extractPlainText(buffer: Buffer): string | null {
  try {
    const text = buffer.toString('utf8');
    return normalizeText(text) || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------
export type ExtractionResult = {
  text: string | null;
  supported: boolean;
  reason: ExtractionReason | null;
  errorMessage: string | null;
};

/**
 * Attempt text extraction from the given buffer based on MIME type / filename extension.
 *
 * Returns:
 *   supported: false  – file type not supported for extraction (still downloadable)
 *   supported: true, text: null  – extraction attempted but produced no text
 *   supported: true, text: string – success
 */
export async function extractDocumentText(
  buffer: Buffer,
  mimeType: string,
  filename: string,
): Promise<ExtractionResult> {
  const mime = String(mimeType || '').toLowerCase();
  const ext = String(filename || '').toLowerCase().split('.').pop() || '';

  if (mime === 'application/pdf' || ext === 'pdf') {
    const result = await extractPdf(buffer);
    return { ...result, supported: true };
  }

  if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === 'docx'
  ) {
    const text = await extractDocx(buffer);
    return {
      text,
      supported: true,
      reason: text ? null : 'no_text_found',
      errorMessage: text ? null : 'No text found in DOCX',
    };
  }

  if (
    mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    ext === 'pptx'
  ) {
    const text = await extractPptx(buffer);
    return {
      text,
      supported: true,
      reason: text ? null : 'no_text_found',
      errorMessage: text ? null : 'No text found in PPTX',
    };
  }

  if (
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    ext === 'xlsx'
  ) {
    const text = await extractXlsx(buffer);
    return {
      text,
      supported: true,
      reason: text ? null : 'no_text_found',
      errorMessage: text ? null : 'No text found in XLSX',
    };
  }

  if (mime === 'text/plain' || mime === 'text/markdown' || ext === 'txt' || ext === 'md') {
    const text = extractPlainText(buffer);
    return {
      text,
      supported: true,
      reason: text ? null : 'no_text_found',
      errorMessage: text ? null : 'No text found in text file',
    };
  }

  return {
    text: null,
    supported: false,
    reason: 'unsupported_type',
    errorMessage: 'Unsupported file type for text extraction',
  };
}

/**
 * Generate a short bullet-point summary (8–12 items) via Vertex AI.
 * Returns null if the AI provider is not configured or the call fails.
 * The caller must handle null gracefully (upload still succeeds).
 */
export async function generateSummary(
  extractedText: string,
  filename: string,
): Promise<string | null> {
  try {
    const { getVertexConfig } = await import('../../_lib/integrations.js');
    const vertexConfig = getVertexConfig();
    if (!vertexConfig.ready || !vertexConfig.credentials) return null;

    const { createSign } = await import('node:crypto');
    const creds = vertexConfig.credentials;
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const claimset = Buffer.from(
      JSON.stringify({
        iss: creds.client_email,
        scope: 'https://www.googleapis.com/auth/cloud-platform',
        aud: creds.token_uri || 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now,
      }),
    ).toString('base64url');

    const unsignedJwt = `${header}.${claimset}`;
    const signer = createSign('RSA-SHA256');
    signer.write(unsignedJwt);
    signer.end();
    const sig = signer.sign(creds.private_key, 'base64url');
    const jwt = `${unsignedJwt}.${sig}`;

    const tokenRes = await fetch(creds.token_uri || 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }).toString(),
    });
    if (!tokenRes.ok) return null;

    const tokenBody: any = await tokenRes.json();
    const accessToken = String(tokenBody?.access_token || '').trim();
    if (!accessToken) return null;

    const projectId = (process.env.GCP_PROJECT_ID || '').trim() || creds.project_id;
    const location = (process.env.GCP_LOCATION || 'us-central1').trim();
    const model = (process.env.VERTEX_MODEL || 'gemini-2.0-flash-001').trim();

    // Truncate to ~6000 chars before sending to keep cost low
    const truncated = extractedText.slice(0, 6000);
    const safeFilename = String(filename || 'document').replace(/"/g, '').slice(0, 80);
    const prompt =
      `Summarize the document "${safeFilename}" in 8–12 short bullet points.\n` +
      `Each bullet must start with "- " and be a single concise sentence.\n` +
      `Capture key facts, constraints, requirements, and terms. No headers, no intro text.\n\n` +
      `Document:\n---\n${truncated}\n---`;

    const endpoint =
      `https://${location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}` +
      `/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;

    const genRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 512, temperature: 0.2 },
      }),
      // @ts-ignore – AbortSignal.timeout is node 17.3+
      signal: AbortSignal.timeout ? AbortSignal.timeout(20_000) : undefined,
    });
    if (!genRes.ok) return null;

    const genBody: any = await genRes.json();
    const text = String(
      genBody?.candidates?.[0]?.content?.parts?.[0]?.text || '',
    ).trim();
    return text || null;
  } catch {
    return null;
  }
}
