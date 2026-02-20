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

  async getById(id) {
    const response = await request(`/api/document-comparisons/${encodeId(id)}`);
    return {
      comparison: response.comparison || null,
      proposal: response.proposal || null,
    };
  },

  async update(id, input = {}) {
    const response = await request(`/api/document-comparisons/${encodeId(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input || {}),
    });
    return response.comparison || null;
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
};
