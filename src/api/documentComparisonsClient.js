import { request } from '@/api/httpClient';

function encodeId(id) {
  return encodeURIComponent(String(id || ''));
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
};
