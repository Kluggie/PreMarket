import { request } from '@/api/httpClient';

function encodeToken(token) {
  return encodeURIComponent(String(token || ''));
}

export const sharedReportsClient = {
  async list(params = {}) {
    const search = new URLSearchParams();

    if (params.comparisonId) {
      search.set('comparisonId', String(params.comparisonId));
    }
    if (params.proposalId) {
      search.set('proposalId', String(params.proposalId));
    }

    const query = search.toString();
    const response = await request(`/api/sharedReports${query ? `?${query}` : ''}`);
    return {
      sharedReports: Array.isArray(response.sharedReports) ? response.sharedReports : [],
    };
  },

  async create(input = {}) {
    const response = await request('/api/sharedReports', {
      method: 'POST',
      body: JSON.stringify(input || {}),
    });

    return {
      token: response.token || null,
      url: response.url || null,
      expiresAt: response.expiresAt || null,
      sharedReport: response.sharedReport || null,
    };
  },

  async send(token, input = {}) {
    const response = await request(`/api/sharedReports/${encodeToken(token)}/send`, {
      method: 'POST',
      body: JSON.stringify(input || {}),
    });
    return {
      sent: Boolean(response.sent),
      token: response.token || token || null,
      url: response.url || null,
      delivery: response.delivery || null,
    };
  },

  async revoke(token) {
    const response = await request(`/api/sharedReports/${encodeToken(token)}/revoke`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    return {
      revoked: Boolean(response.revoked),
      sharedReport: response.sharedReport || null,
    };
  },

  async getByToken(token) {
    const response = await request(`/api/sharedReports/${encodeToken(token)}`);
    return {
      sharedReport: response.sharedReport || null,
    };
  },

  async getRecipientWorkspace(token) {
    const response = await request(`/api/shared-report/${encodeToken(token)}`);
    return {
      share: response.share || null,
      parent: response.parent || null,
      latestReport: response.latestReport || {},
      currentDraft: response.currentDraft || null,
      defaults: response.defaults || {},
    };
  },

  async saveRecipientDraft(token, input = {}) {
    const response = await request(`/api/shared-report/${encodeToken(token)}/draft`, {
      method: 'POST',
      body: JSON.stringify(input || {}),
    });
    return {
      ok: Boolean(response.ok),
      draftId: response.draft_id || null,
      updatedAt: response.updated_at || null,
    };
  },

  async respond(token, input = {}) {
    const response = await request(`/api/sharedReports/${encodeToken(token)}/respond`, {
      method: 'POST',
      body: JSON.stringify(input || {}),
    });

    return {
      sharedReport: response.sharedReport || null,
      savedResponses: Number(response.savedResponses || 0),
    };
  },
};
