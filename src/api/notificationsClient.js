import { request } from '@/api/httpClient';

export const notificationsClient = {
  async list() {
    const response = await request('/api/notifications');
    if (!Array.isArray(response.notifications)) {
      const err = new Error('Server response missing "notifications" array');
      err.code = 'invalid_response';
      throw err;
    }
    return response.notifications;
  },


  async markRead(id) {
    await request(`/api/notifications/${encodeURIComponent(String(id || ''))}`, {
      method: 'PATCH',
      body: JSON.stringify({ read: true }),
    });
  },

  async dismiss(id) {
    await request(`/api/notifications/${encodeURIComponent(String(id || ''))}`, {
      method: 'PATCH',
      body: JSON.stringify({ dismissed: true }),
    });
  },
};
