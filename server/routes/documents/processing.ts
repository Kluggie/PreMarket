import { extractDocumentText } from './text-extraction.js';

export const EXTRACTED_TEXT_CAP = 200 * 1024; // 200 KB
export const PROCESSING_TIMEOUT_MS = 15_000;

export type DocumentProcessingStatus = 'ready' | 'not_supported' | 'failed';
export type DocumentAiStatus = 'processing' | 'usable' | 'not_usable';

export type DocumentProcessingResult = {
  status: DocumentProcessingStatus;
  statusReason: string | null;
  extractedText: string | null;
  summaryText: string | null;
  errorMessage: string | null;
};

type ProcessWithTimeoutInput = {
  buffer: Buffer;
  filename: string;
  mimeType: string;
};

type DeriveAiStateInput = {
  status: unknown;
  statusReason: unknown;
  extractedText: unknown;
};

export function mapNoTextReasonToError(reason: string | null, fallback: string | null) {
  if (reason === 'encrypted_pdf') {
    return 'PDF is encrypted and cannot be processed';
  }
  if (reason === 'no_text_found') {
    return 'No extractable text was found (the file may be image-only or empty)';
  }
  if (reason === 'unsupported_type') {
    return 'This file type is not supported for text extraction';
  }
  if (reason === 'processing_timeout') {
    return 'Document processing timed out. Try again.';
  }
  return fallback || 'Text extraction failed';
}

async function processDocumentCore(
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<DocumentProcessingResult> {
  const extraction = await extractDocumentText(buffer, mimeType, filename);

  if (!extraction.supported) {
    return {
      status: 'not_supported',
      statusReason: extraction.reason || 'unsupported_type',
      extractedText: null,
      summaryText: null,
      errorMessage: mapNoTextReasonToError(extraction.reason, extraction.errorMessage),
    };
  }

  const rawText = extraction.text;
  if (!rawText) {
    const reason = extraction.reason || 'no_text_found';
    return {
      status: reason === 'extraction_failed' ? 'failed' : 'not_supported',
      statusReason: reason,
      extractedText: null,
      summaryText: null,
      errorMessage: mapNoTextReasonToError(reason, extraction.errorMessage),
    };
  }

  // AI usability is driven by extracted text availability, not summary generation.
  return {
    status: 'ready',
    statusReason: null,
    extractedText: rawText.slice(0, EXTRACTED_TEXT_CAP),
    summaryText: null,
    errorMessage: null,
  };
}

export async function processDocumentWithTimeout(
  input: ProcessWithTimeoutInput,
): Promise<DocumentProcessingResult> {
  const timeoutPromise = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), PROCESSING_TIMEOUT_MS),
  );

  const result = await Promise.race([
    processDocumentCore(input.buffer, input.filename, input.mimeType).catch((err: any) => ({
      status: 'failed' as const,
      statusReason: 'extraction_failed',
      extractedText: null,
      summaryText: null,
      errorMessage: String(err?.message || 'Processing failed').slice(0, 500),
    })),
    timeoutPromise,
  ]);

  if (result === null) {
    return {
      status: 'failed',
      statusReason: 'processing_timeout',
      extractedText: null,
      summaryText: null,
      errorMessage: mapNoTextReasonToError('processing_timeout', null),
    };
  }

  return result;
}

export function deriveDocumentAiState(input: DeriveAiStateInput): {
  aiStatus: DocumentAiStatus;
  aiReason: string | null;
  extractedTextChars: number;
} {
  const status = String(input.status || '').trim().toLowerCase();
  const statusReason = String(input.statusReason || '').trim().toLowerCase() || null;
  const extractedText = typeof input.extractedText === 'string' ? input.extractedText : '';
  const extractedTextChars = extractedText.trim().length;

  if (status === 'processing') {
    return {
      aiStatus: 'processing',
      aiReason: null,
      extractedTextChars,
    };
  }

  if (status === 'ready' && extractedTextChars > 0) {
    return {
      aiStatus: 'usable',
      aiReason: null,
      extractedTextChars,
    };
  }

  if (status === 'ready' && extractedTextChars === 0) {
    return {
      aiStatus: 'not_usable',
      aiReason: statusReason || 'no_text_found',
      extractedTextChars,
    };
  }

  if (status === 'failed' || status === 'not_supported') {
    return {
      aiStatus: 'not_usable',
      aiReason: statusReason || (status === 'not_supported' ? 'unsupported_type' : 'extraction_failed'),
      extractedTextChars,
    };
  }

  return {
    aiStatus: extractedTextChars > 0 ? 'usable' : 'not_usable',
    aiReason: extractedTextChars > 0 ? null : statusReason || 'extraction_failed',
    extractedTextChars,
  };
}

