import { request } from '@/api/httpClient';

function encodeToken(token) {
  return encodeURIComponent(String(token || ''));
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

  const filenameMatch = header.match(/filename=\"?([^\";]+)\"?/i);
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
      baselineAiReport: response.baseline_ai_report || null,
      recipientDraft: response.recipientDraft || null,
      latestEvaluation: response.latestEvaluation || null,
      latestSentRevision: response.latestSentRevision || null,
      latestReport: response.latestReport || null,
      currentDraft: response.currentDraft || null,
      defaults: response.defaults || null,
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

  async coachRecipient(token, input = {}) {
    const response = await request(`/api/shared-report/${encodeToken(token)}/coach`, {
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

  async companyBriefRecipient(token, input = {}) {
    const response = await request(`/api/shared-report/${encodeToken(token)}/company-brief`, {
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

  async startRecipientVerification(token) {
    const response = await request(`/api/shared-report/${encodeToken(token)}/verify/start`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    return {
      started: Boolean(response.started),
      message: response.message || 'If permitted, a verification code was sent.',
    };
  },

  async confirmRecipientVerification(token, code) {
    const response = await request(`/api/shared-report/${encodeToken(token)}/verify/confirm`, {
      method: 'POST',
      body: JSON.stringify({
        code: String(code || ''),
      }),
    });
    return {
      verified: Boolean(response.verified),
      invitedEmail: response.invited_email || null,
      authorizedEmail: response.authorized_email || null,
      authorizedAt: response.authorized_at || null,
    };
  },

  async respond(token, input = {}) {
    const response = await request(`/api/sharedReports/${encodeToken(token)}/respond`, {
      method: 'POST',
      body: JSON.stringify(input || {}),
    });

    return {
      sharedReport: response.sharedReport || null,
      savedResponses: typeof response.savedResponses === 'number' ? response.savedResponses : 0,
    };
  },

  async downloadRecipientAiReportPdf(token) {
    return downloadPdfFile(
      `/api/shared-report/${encodeToken(token)}/download/pdf`,
      'shared-report-ai-report.pdf',
    );
  },

  async downloadRecipientProposalPdf(token) {
    return downloadPdfFile(
      `/api/shared-report/${encodeToken(token)}/download/proposal-pdf`,
      'shared-report-proposal.pdf',
    );
  },
};
