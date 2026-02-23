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

function toFriendlyImportError(error) {
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
    return response.comparisons || [];
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
      proposal: response.proposal || null,
    };
  },

  async downloadJson(id) {
    const response = await request(`/api/document-comparisons/${encodeId(id)}/download/json`);
    return {
      filename: response.filename || 'document-comparison.json',
      report: response.report || {},
    };
  },

  async downloadInputs(id) {
    const response = await request(`/api/document-comparisons/${encodeId(id)}/download/inputs`);
    return {
      filename: response.filename || 'document-comparison-inputs.json',
      inputs: response.inputs || {},
    };
  },

  async downloadPdf(id) {
    return request(`/api/document-comparisons/${encodeId(id)}/download/pdf`);
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

  async extractDocumentFromFile(file) {
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

    try {
      const fileBase64 = await arrayBufferToBase64(await file.arrayBuffer());
      const response = await request('/api/documents/extract', {
        method: 'POST',
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
      throw toFriendlyImportError(error);
    }
  },
};
