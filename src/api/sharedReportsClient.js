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
    const response = await request(`/api/shared-report/${encodeToken(token)}/workspace`);
    return {
      share: response.share || null,
      parent: response.parent || null,
      comparison: response.comparison || null,
      baseline: response.baseline || null,
      baselineShared: response.baseline_shared || null,
      baselineAiReport: response.baseline_ai_report || {},
      recipientDraft: response.recipientDraft || null,
      latestEvaluation: response.latestEvaluation || null,
      latestSentRevision: response.latestSentRevision || null,
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

  async evaluateRecipient(token) {
    const response = await request(`/api/shared-report/${encodeToken(token)}/evaluate`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    return {
      ok: Boolean(response.ok),
      evaluationId: response.evaluation_id || null,
      evaluation: response.evaluation || null,
    };
  },

  async sendBackRecipient(token) {
    const response = await request(`/api/shared-report/${encodeToken(token)}/send-back`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    return {
      ok: Boolean(response.ok),
      revisionId: response.revision_id || null,
      status: response.status || null,
      sentAt: response.sent_at || null,
      evaluationId: response.evaluation_id || null,
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
