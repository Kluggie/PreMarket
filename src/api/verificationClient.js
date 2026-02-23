import { request } from '@/api/httpClient';

export const verificationClient = {
  async getStatus() {
    const response = await request('/api/account/verification/status');
    return response.verification || null;
  },

  async sendEmail() {
    const response = await request('/api/account/verification/send', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    return {
      sent: Boolean(response.sent),
      alreadyVerified: Boolean(response.already_verified),
      expiresAt: response.expires_at || null,
      verificationStatus: response.verification_status || null,
    };
  },

  async confirm(token) {
    const response = await request('/api/account/verification/confirm', {
      method: 'POST',
      body: JSON.stringify({
        token: String(token || ''),
      }),
    });

    return {
      verified: Boolean(response.verified),
      verification: response.verification || null,
    };
  },
};
