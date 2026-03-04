import { request } from '@/api/httpClient';

const APP_LOG_DEDUPE_WINDOW_MS = 3000;
const recentPageLogs = new Map();
const pendingPageLogs = new Map();

export const appLogsClient = {
  async logUserInApp(page, context = {}) {
    const normalizedPage = String(page || '').trim();
    if (!normalizedPage) {
      return { sent: false, reason: 'empty-page' };
    }

    const now = Date.now();
    const lastLoggedAt = Number(recentPageLogs.get(normalizedPage) || 0);
    if (lastLoggedAt && now - lastLoggedAt < APP_LOG_DEDUPE_WINDOW_MS) {
      if (import.meta.env.DEV) {
        console.info('[appLogsClient] skipped duplicate app-log', {
          page: normalizedPage,
          reason: 'dedupe-window',
          dedupeWindowMs: APP_LOG_DEDUPE_WINDOW_MS,
          elapsedMs: now - lastLoggedAt,
          ...context,
        });
      }
      return { sent: false, reason: 'deduped' };
    }

    const inFlight = pendingPageLogs.get(normalizedPage);
    if (inFlight) {
      return inFlight;
    }

    const sendPromise = (async () => {
      await request('/api/app-logs', {
        method: 'POST',
        body: JSON.stringify({ page: normalizedPage }),
      });
      recentPageLogs.set(normalizedPage, Date.now());
      if (import.meta.env.DEV) {
        console.info('[appLogsClient] sent app-log', {
          page: normalizedPage,
          ...context,
        });
      }
      return { sent: true, reason: 'sent' };
    })().finally(() => {
      pendingPageLogs.delete(normalizedPage);
    });

    pendingPageLogs.set(normalizedPage, sendPromise);
    return sendPromise;
  },
};
