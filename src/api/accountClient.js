import { request } from '@/api/httpClient';

export const accountClient = {
  async getProfile() {
    const response = await request('/api/account/profile');
    return response.profile || null;
  },

  async saveProfile(profile = {}) {
    const response = await request('/api/account/profile', {
      method: 'PATCH',
      body: JSON.stringify({
        profile,
      }),
    });

    return response.profile || null;
  },

  async getOrganizations() {
    const response = await request('/api/account/organizations');
    if (!Array.isArray(response.organizations) || !Array.isArray(response.memberships)) {
      const err = new Error('Server response missing "organizations" or "memberships" arrays');
      err.code = 'invalid_response';
      throw err;
    }
    return {
      organizations: response.organizations,
      memberships: response.memberships,
    };
  },

  async createOrganization(organization = {}) {
    const response = await request('/api/account/organizations', {
      method: 'POST',
      body: JSON.stringify({
        organization,
      }),
    });

    return {
      organization: response.organization || null,
      membership: response.membership || null,
    };
  },

  async updateOrganization(id, organization = {}) {
    const response = await request(`/api/account/organizations/${encodeURIComponent(String(id || ''))}`, {
      method: 'PATCH',
      body: JSON.stringify({
        organization,
      }),
    });

    return response.organization || null;
  },

  async getEmailConfigStatus() {
    const response = await request('/api/account/email-config-status');
    return {
      hasResendKey: Boolean(response.hasResendKey),
      fromEmail: response.fromEmail || null,
      fromName: response.fromName || null,
      fromDomain: response.fromDomain || null,
      replyTo: response.replyTo || null,
      replyToDomain: response.replyToDomain || null,
      baseUrl: response.baseUrl || null,
      environment: response.environment || 'development',
      isValidConfig: Boolean(response.isValidConfig),
    };
  },
};
