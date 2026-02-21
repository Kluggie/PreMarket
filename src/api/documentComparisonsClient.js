import { request } from '@/api/httpClient';

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

function isPlainTextFile(file) {
  const extension = getFileExtension(file);
  const mime = String(file?.type || '').toLowerCase();
  return extension === 'txt' || extension === 'md' || mime.startsWith('text/');
}

async function extractTextFromPdf(file) {
  const [{ getDocument, GlobalWorkerOptions }, workerModule] = await Promise.all([
    import('pdfjs-dist/build/pdf.mjs'),
    import('pdfjs-dist/build/pdf.worker.mjs?url'),
  ]);

  if (workerModule?.default && GlobalWorkerOptions.workerSrc !== workerModule.default) {
    GlobalWorkerOptions.workerSrc = workerModule.default;
  }

  const pdf = await getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => (typeof item?.str === 'string' ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (pageText) {
      pages.push(pageText);
    }
  }

  return normalizeExtractedText(pages.join('\n\n'));
}

async function extractTextFromDocx(file) {
  const mammoth = await import('mammoth/mammoth.browser');
  const { value } = await mammoth.extractRawText({
    arrayBuffer: await file.arrayBuffer(),
  });
  return normalizeExtractedText(value);
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
    if (!file || typeof file.arrayBuffer !== 'function') {
      const error = new Error('A valid file is required for extraction');
      error.code = 'invalid_input';
      error.status = 400;
      throw error;
    }

    if (isPlainTextFile(file)) {
      return normalizeExtractedText(await file.text());
    }

    if (isPdfFile(file)) {
      try {
        return await extractTextFromPdf(file);
      } catch (error) {
        const wrapped = new Error('Failed to extract text from PDF');
        wrapped.code = 'extract_failed';
        wrapped.status = 422;
        wrapped.cause = error;
        throw wrapped;
      }
    }

    if (isDocxFile(file)) {
      try {
        return await extractTextFromDocx(file);
      } catch (error) {
        const wrapped = new Error('Failed to extract text from DOCX');
        wrapped.code = 'extract_failed';
        wrapped.status = 422;
        wrapped.cause = error;
        throw wrapped;
      }
    }

    const extension = getFileExtension(file) || 'unknown';
    const notConfigured = new Error(`.${extension} extraction is not configured`);
    notConfigured.code = 'not_configured';
    notConfigured.status = 501;
    throw notConfigured;
  },
};
