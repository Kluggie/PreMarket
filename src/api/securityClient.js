import { request } from '@/api/httpClient';

export const securityClient = {
  async getSessions() {
    const response = await request('/api/security/sessions');
    return Array.isArray(response.sessions) ? response.sessions : [];
  },

  async revokeSession(sessionId) {
    return request('/api/security/sessions/revoke', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: String(sessionId || ''),
      }),
    });
  },

  async revokeAllSessions(options = {}) {
    return request('/api/security/sessions/revoke-all', {
      method: 'POST',
      body: JSON.stringify({
        includeCurrent: Boolean(options.includeCurrent),
      }),
    });
  },

  async getActivity(limit = 50) {
    const normalizedLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(200, Math.floor(limit))) : 50;
    const response = await request(`/api/security/activity?limit=${normalizedLimit}`);
    return Array.isArray(response.events) ? response.events : [];
  },

  async getMfaStatus() {
    const response = await request('/api/security/mfa/status');
    return response.mfa || null;
  },

  async startMfaEnrollment() {
    const response = await request('/api/security/mfa/enroll/start', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    return response.enrollment || null;
  },

  async confirmMfaEnrollment(code) {
    return request('/api/security/mfa/enroll/confirm', {
      method: 'POST',
      body: JSON.stringify({
        code: String(code || ''),
      }),
    });
  },

  async disableMfa(codeOrBackup) {
    return request('/api/security/mfa/disable', {
      method: 'POST',
      body: JSON.stringify({
        codeOrBackup: String(codeOrBackup || ''),
      }),
    });
  },

  async regenerateBackupCodes(code) {
    return request('/api/security/mfa/backup/regenerate', {
      method: 'POST',
      body: JSON.stringify({
        code: String(code || ''),
      }),
    });
  },

  async challengeMfa(codeOrBackup) {
    return request('/api/security/mfa/challenge', {
      method: 'POST',
      body: JSON.stringify({
        codeOrBackup: String(codeOrBackup || ''),
      }),
    });
  },
};
