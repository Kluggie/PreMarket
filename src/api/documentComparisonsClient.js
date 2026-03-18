import { request } from '@/api/httpClient';

const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;

function encodeId(id) {
  return encodeURIComponent(String(id || ''));
}

function getFileExtension(file) {
  const filename = String(file?.name || '').toLowerCase();
  if (!filename.includes('.')) {
    return '';
  }
  return filename.split('.').pop() || '';
}

function normalizeExtractedText(value) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\r/g, '')
    .trim();
}

function isPdfFile(file) {
  const extension = getFileExtension(file);
  return extension === 'pdf' || String(file?.type || '').toLowerCase() === 'application/pdf';
}

function isDocxFile(file) {
  const extension = getFileExtension(file);
  const mime = String(file?.type || '').toLowerCase();
  return (
    extension === 'docx' ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
}

function inferSupportedMimeType(file) {
  if (isDocxFile(file)) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (isPdfFile(file)) {
    return 'application/pdf';
  }
  return '';
}

function createImportError(message, code, status, body = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (body) {
    error.body = body;
  }
  return error;
}

function createAbortError() {
  try {
    return new DOMException('The operation was aborted.', 'AbortError');
  } catch {
    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    return error;
  }
}

function toFriendlyImportError(error) {
  if (error?.name === 'AbortError') {
    return error;
  }

  const code = String(error?.code || '').trim();
  const status = Number(error?.status || 0);

  if (status === 413 || code === 'payload_too_large') {
    return createImportError('File is too large. Maximum supported size is 5MB.', 'payload_too_large', 413, error?.body);
  }

  if (code === 'invalid_file_type') {
    return createImportError(
      'Unsupported file type. Please upload a DOCX (.docx) or PDF (.pdf) file.',
      'invalid_file_type',
      400,
      error?.body,
    );
  }

  if (code === 'invalid_input') {
    return createImportError(
      'Unable to read the selected file payload. Please re-select the file and try again.',
      'invalid_input',
      400,
      error?.body,
    );
  }

  if (code === 'extract_failed') {
    return createImportError(
      error?.message || 'Could not extract text from this file. Try a different DOCX/PDF.',
      'extract_failed',
      400,
      error?.body,
    );
  }

  return error;
}

function arrayBufferToBase64(arrayBuffer) {
  return new Promise((resolve, reject) => {
    try {
      const blob = new Blob([arrayBuffer]);
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => {
        reject(new Error('Failed to encode file payload'));
      };
      reader.readAsDataURL(blob);
    } catch (error) {
      reject(error);
    }
  });
}

function parseDownloadFilename(contentDisposition, fallback) {
  const header = String(contentDisposition || '');
  if (!header) {
    return fallback;
  }

  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const filenameMatch = header.match(/filename="?([^\";]+)"?/i);
  if (filenameMatch?.[1]) {
    return filenameMatch[1];
  }

  return fallback;
}

async function parseErrorResponse(response) {
  let body = {};
  try {
    body = await response.json();
  } catch {
    body = {};
  }

  const message = body?.error?.message || body?.message || 'Download failed';
  const code = body?.error?.code || 'request_failed';
  const error = new Error(message);
  error.status = response.status;
  error.code = code;
  error.body = body;
  throw error;
}

async function downloadPdfFile(path, fallbackFilename) {
  const response = await fetch(path, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    await parseErrorResponse(response);
  }

  const blob = await response.blob();
  const filename = parseDownloadFilename(response.headers.get('content-disposition'), fallbackFilename);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);

  return {
    filename,
    bytes: Number(blob.size || 0),
  };
}

export const documentComparisonsClient = {
  async list(params = {}) {
    const searchParams = new URLSearchParams();

    if (params.status) {
      searchParams.set('status', String(params.status));
    }

    if (params.limit) {
      searchParams.set('limit', String(params.limit));
    }

    const query = searchParams.toString();
    const response = await request(`/api/document-comparisons${query ? `?${query}` : ''}`);
    if (!Array.isArray(response.comparisons)) {
      const err = new Error('Server response missing "comparisons" array');
      err.code = 'invalid_response';
      throw err;
    }
    return response.comparisons;
  },

  async create(input = {}) {
    const response = await request('/api/document-comparisons', {
      method: 'POST',
      body: JSON.stringify(input || {}),
    });
    return response.comparison || null;
  },

  async saveDraft(comparisonId, input = {}) {
    if (comparisonId) {
      return this.update(comparisonId, input);
    }
    return this.create(input);
  },

  async getById(id) {
    const response = await request(`/api/document-comparisons/${encodeId(id)}`);
    return {
      comparison: response.comparison || null,
      proposal: response.proposal || null,
      permissions: response.permissions || null,
    };
  },

  async getByIdWithToken(id, token) {
    const query = new URLSearchParams();
    if (token) {
      query.set('token', String(token));
    }
    const response = await request(
      `/api/document-comparisons/${encodeId(id)}${query.toString() ? `?${query.toString()}` : ''}`,
    );
    return {
      comparison: response.comparison || null,
      proposal: response.proposal || null,
      permissions: response.permissions || null,
    };
  },

  async update(id, input = {}) {
    const response = await request(`/api/document-comparisons/${encodeId(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input || {}),
    });
    return {
      comparison: response.comparison || null,
      permissions: response.permissions || null,
    };
  },

  async evaluate(id, input = {}) {
    const response = await request(`/api/document-comparisons/${encodeId(id)}/evaluate`, {
      method: 'POST',
      body: JSON.stringify(input || {}),
    });
    return {
      comparison: response.comparison || null,
      evaluation: response.evaluation || null,
      evaluationProvider:
        typeof response.evaluation_provider === 'string' ? response.evaluation_provider : null,
      evaluationModel:
        typeof response.evaluation_model === 'string' ? response.evaluation_model : null,
      evaluationProviderReason:
        typeof response.evaluation_provider_reason === 'string'
          ? response.evaluation_provider_reason
          : null,
      proposal: response.proposal || null,
      evaluationInputTrace: response.evaluation_input_trace || null,
      requestId: response.request_id || null,
      attemptCount: typeof response.attempt_count === 'number' ? response.attempt_count : 0,
    };
  },

  async guestEvaluate(input = {}) {
    const response = await request('/api/public/document-comparisons/evaluate', {
      method: 'POST',
      body: JSON.stringify(input || {}),
    });
    return {
      comparison: response.comparison || null,
      evaluation: response.evaluation || null,
      evaluationResult: response.evaluation_result || null,
      evaluationInputTrace: response.evaluation_input_trace || null,
      requestId: response.request_id || null,
      attemptCount: typeof response.attempt_count === 'number' ? response.attempt_count : 0,
    };
  },

  async coach(id, input = {}) {
    const response = await request(`/api/document-comparisons/${encodeId(id)}/coach`, {
      method: 'POST',
      body: JSON.stringify(input || {}),
    });
    return {
      comparisonId: response.comparison_id || id,
      cacheHash: response.cache_hash || null,
      cached: Boolean(response.cached),
      provider: typeof response.provider === 'string' ? response.provider : 'vertex',
      model: typeof response.model === 'string' ? response.model : 'unknown',
      promptVersion: typeof response.prompt_version === 'string' ? response.prompt_version : null,
      coach: response.coach || null,
      createdAt: response.created_at || null,
      withheldCount: typeof response.withheld_count === 'number' ? response.withheld_count : 0,
    };
  },

  async guestCoach(input = {}) {
    const response = await request('/api/public/document-comparisons/coach', {
      method: 'POST',
      body: JSON.stringify(input || {}),
    });
    return {
      comparisonId: response.comparison_id || null,
      cacheHash: response.cache_hash || null,
      cached: Boolean(response.cached),
      provider: typeof response.provider === 'string' ? response.provider : 'vertex',
      model: typeof response.model === 'string' ? response.model : 'unknown',
      promptVersion: typeof response.prompt_version === 'string' ? response.prompt_version : null,
      coach: response.coach || null,
      createdAt: response.created_at || null,
      withheldCount: typeof response.withheld_count === 'number' ? response.withheld_count : 0,
    };
  },

  async updateCompanyContext(id, input = {}) {
    const response = await request(`/api/document-comparisons/${encodeId(id)}/company-context`, {
      method: 'PATCH',
      body: JSON.stringify(input || {}),
    });
    return {
      comparisonId: response.comparison_id || id,
      companyContext: response.company_context || {
        company_name: null,
        company_website: null,
      },
      updatedAt: response.updated_at || null,
    };
  },

  async companyBrief(id, input = {}) {
    const response = await request(`/api/document-comparisons/${encodeId(id)}/company-brief`, {
      method: 'POST',
      body: JSON.stringify(input || {}),
    });
    return {
      comparisonId: response.comparison_id || id,
      provider: typeof response.provider === 'string' ? response.provider : 'vertex',
      model: typeof response.model === 'string' ? response.model : 'unknown',
      companyBrief: response.company_brief || null,
      generatedAt: response.generated_at || null,
    };
  },

  async guestCompanyBrief(input = {}) {
    const response = await request('/api/public/document-comparisons/company-brief', {
      method: 'POST',
      body: JSON.stringify(input || {}),
    });
    return {
      comparisonId: response.comparison_id || null,
      provider: typeof response.provider === 'string' ? response.provider : 'vertex',
      model: typeof response.model === 'string' ? response.model : 'unknown',
      companyBrief: response.company_brief || null,
      generatedAt: response.generated_at || null,
    };
  },

  async downloadJson(id) {
    const response = await request(`/api/document-comparisons/${encodeId(id)}/download/json`);
    // Throw if report is absent — silently returning {} would give the user an
    // empty JSON file with no indication that the report was not returned.
    if (!response.report || typeof response.report !== 'object') {
      const err = new Error('Server response missing "report" for JSON download');
      err.code = 'invalid_response';
      throw err;
    }
    return {
      filename: response.filename || 'document-comparison.json',
      report: response.report,
    };
  },

  async downloadInputs(id) {
    const response = await request(`/api/document-comparisons/${encodeId(id)}/download/inputs`);
    // Throw if inputs are absent — same reasoning as downloadJson.
    if (!response.inputs || typeof response.inputs !== 'object') {
      const err = new Error('Server response missing "inputs" for inputs download');
      err.code = 'invalid_response';
      throw err;
    }
    return {
      filename: response.filename || 'document-comparison-inputs.json',
      inputs: response.inputs,
    };
  },

  async downloadPdf(id) {
    return downloadPdfFile(
      `/api/document-comparisons/${encodeId(id)}/download/pdf`,
      'document-comparison-ai-mediation-review.pdf',
    );
  },

  async downloadProposalPdf(id) {
    return downloadPdfFile(
      `/api/document-comparisons/${encodeId(id)}/download/proposal-pdf`,
      'document-comparison-proposal-details.pdf',
    );
  },

  async extractUrl(url) {
    const response = await request('/api/document-comparisons/extract-url', {
      method: 'POST',
      body: JSON.stringify({
        url: String(url || ''),
      }),
    });
    return {
      ok: response.ok !== false,
      text: typeof response.text === 'string' ? response.text : '',
      title: typeof response.title === 'string' ? response.title : null,
    };
  },

  async extractTextFromFile(file) {
    const extracted = await this.extractDocumentFromFile(file);
    return normalizeExtractedText(extracted?.text || '');
  },

  validateImportFile(file) {
    if (!file || typeof file.arrayBuffer !== 'function') {
      const error = new Error('A valid file is required for extraction');
      error.code = 'invalid_input';
      error.status = 400;
      throw error;
    }

    const mimeType = inferSupportedMimeType(file);
    if (!mimeType) {
      const extension = getFileExtension(file) || 'unknown';
      const notConfigured = new Error(`Unsupported file type .${extension}. Please use DOCX or PDF.`);
      notConfigured.code = 'invalid_file_type';
      notConfigured.status = 400;
      throw notConfigured;
    }

    if (Number(file.size || 0) > MAX_IMPORT_FILE_BYTES) {
      throw createImportError('File is too large. Maximum supported size is 5MB.', 'payload_too_large', 413);
    }
    return { mimeType };
  },

  async extractDocumentFromFile(file, options = {}) {
    const { mimeType } = this.validateImportFile(file);
    const signal = options?.signal;

    if (signal?.aborted) {
      throw createAbortError();
    }

    try {
      const fileBase64 = await arrayBufferToBase64(await file.arrayBuffer());

      if (signal?.aborted) {
        throw createAbortError();
      }

      const response = await request('/api/documents/extract', {
        method: 'POST',
        signal,
        body: JSON.stringify({
          filename: String(file.name || 'document'),
          mimeType,
          fileBase64,
        }),
      });

      return {
        ok: response.ok !== false,
        text: normalizeExtractedText(response.text || ''),
        html: typeof response.html === 'string' ? response.html : '',
        filename: typeof response.filename === 'string' ? response.filename : String(file.name || ''),
        mimeType: typeof response.mimeType === 'string' ? response.mimeType : mimeType,
      };
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw error;
      }
      throw toFriendlyImportError(error);
    }
  },
};
