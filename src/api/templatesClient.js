import { request } from '@/api/httpClient';

export const templatesClient = {
  async list(params = {}) {
    const searchParams = new URLSearchParams();

    if (params.includeInactive) {
      searchParams.set('include_inactive', 'true');
    }

    const query = searchParams.toString();
    const response = await request(`/api/templates${query ? `?${query}` : ''}`);
    return response.templates || [];
  },

  async useTemplate(templateId, input = {}) {
    const response = await request(`/api/templates/${encodeURIComponent(String(templateId || ''))}/use`, {
      method: 'POST',
      body: JSON.stringify(input || {}),
    });

    return {
      proposal: response.proposal || null,
      snapshot: response.snapshot || null,
      idempotent: Boolean(response.idempotent),
    };
  },
};
