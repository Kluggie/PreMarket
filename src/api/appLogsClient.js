import { request } from '@/api/httpClient';

export const appLogsClient = {
  async logUserInApp(page) {
    await request('/api/app-logs', {
      method: 'POST',
      body: JSON.stringify({ page }),
    });
  },
};
