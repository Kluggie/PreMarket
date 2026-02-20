import { fail } from '../server/_lib/api-response.js';
import healthHandler from '../server/routes/health.js';
import stripeWebhookHandler from '../server/routes/stripeWebhook.js';
import authMeHandler from '../server/routes/auth/me.js';
import authLogoutHandler from '../server/routes/auth/logout.js';
import authCsrfHandler from '../server/routes/auth/csrf.js';
import authGoogleVerifyHandler from '../server/routes/auth/google/verify.js';
import emailSendHandler from '../server/routes/email/send.js';
import proposalsHandler from '../server/routes/proposals/index.js';
import proposalsIdHandler from '../server/routes/proposals/[id].js';
import proposalResponsesHandler from '../server/routes/proposals/[id]/responses.js';
import sharedLinksHandler from '../server/routes/shared-links/index.js';
import sharedLinksTokenHandler from '../server/routes/shared-links/[token].js';
import vertexSmokeHandler from '../server/routes/vertex/smoke.js';
import billingHandler from '../server/routes/billing/index.js';
import notificationsHandler from '../server/routes/notifications/index.js';
import notificationsIdHandler from '../server/routes/notifications/[id].js';
import appLogsHandler from '../server/routes/app-logs/index.js';
import verificationItemsHandler from '../server/routes/verification-items/index.js';
import dashboardSummaryHandler from '../server/routes/dashboard/summary.js';
import dashboardActivityHandler from '../server/routes/dashboard/activity.js';
import contactRequestsHandler from '../server/routes/contact-requests/index.js';
import templatesHandler from '../server/routes/templates/index.js';
import templatesUseHandler from '../server/routes/templates/[id]/use.js';
import templatesViewHandler from '../server/routes/templates/[id]/view.js';

type VercelRequest = {
  method?: string;
  url?: string;
  query?: Record<string, unknown>;
};

function normalizePathname(pathname: string) {
  const compacted = pathname.replace(/\/+/g, '/');

  if (compacted.length > 1 && compacted.endsWith('/')) {
    return compacted.slice(0, -1);
  }

  return compacted;
}

function stripRouterPathQuery(req: VercelRequest) {
  if (!req.query || typeof req.query !== 'object') {
    return;
  }

  if (!Object.prototype.hasOwnProperty.call(req.query, 'path')) {
    return;
  }

  const nextQuery = {
    ...req.query,
  };

  delete nextQuery.path;
  req.query = nextQuery;
}

function getPathname(req: VercelRequest) {
  const url = new URL(req.url || '', 'http://local');
  const path = url.searchParams.get('path') || '';
  const pathname = path ? `/api/${path}` : '/api';
  return normalizePathname(pathname);
}

export default async function handler(req: any, res: any) {
  const method = String(req.method || 'GET').toUpperCase();
  const pathname = getPathname(req);

  stripRouterPathQuery(req);

  if (pathname === '/api/health' && method === 'GET') {
    return healthHandler(req, res);
  }

  if (pathname === '/api/stripeWebhook' && method === 'POST') {
    return stripeWebhookHandler(req, res);
  }

  if (pathname === '/api/auth/me' && method === 'GET') {
    return authMeHandler(req, res);
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    return authLogoutHandler(req, res);
  }

  if (pathname === '/api/auth/csrf' && method === 'GET') {
    return authCsrfHandler(req, res);
  }

  if (pathname === '/api/auth/google/verify' && method === 'POST') {
    return authGoogleVerifyHandler(req, res);
  }

  if (pathname === '/api/email/send' && method === 'POST') {
    return emailSendHandler(req, res);
  }

  if (pathname === '/api/vertex/smoke' && method === 'POST') {
    return vertexSmokeHandler(req, res);
  }

  if (pathname === '/api/proposals' && (method === 'GET' || method === 'POST')) {
    return proposalsHandler(req, res);
  }

  if (pathname === '/api/dashboard/summary' && method === 'GET') {
    return dashboardSummaryHandler(req, res);
  }

  if (pathname === '/api/dashboard/activity' && method === 'GET') {
    return dashboardActivityHandler(req, res);
  }

  const proposalMatch = pathname.match(/^\/api\/proposals\/([^/]+)$/);
  if (proposalMatch && ['GET', 'PATCH', 'DELETE'].includes(method)) {
    const id = decodeURIComponent(proposalMatch[1]);
    return proposalsIdHandler(req, res, id);
  }

  if (pathname === '/api/templates' && method === 'GET') {
    return templatesHandler(req, res);
  }

  if (pathname === '/api/contact-requests' && method === 'POST') {
    return contactRequestsHandler(req, res);
  }

  const proposalResponsesMatch = pathname.match(/^\/api\/proposals\/([^/]+)\/responses$/);
  if (proposalResponsesMatch && ['GET', 'PUT'].includes(method)) {
    const id = decodeURIComponent(proposalResponsesMatch[1]);
    return proposalResponsesHandler(req, res, id);
  }

  const templatesUseMatch = pathname.match(/^\/api\/templates\/([^/]+)\/use$/);
  if (templatesUseMatch && method === 'POST') {
    const id = decodeURIComponent(templatesUseMatch[1]);
    return templatesUseHandler(req, res, id);
  }

  const templatesViewMatch = pathname.match(/^\/api\/templates\/([^/]+)\/view$/);
  if (templatesViewMatch && method === 'POST') {
    const id = decodeURIComponent(templatesViewMatch[1]);
    return templatesViewHandler(req, res, id);
  }

  if (pathname === '/api/shared-links' && (method === 'GET' || method === 'POST')) {
    return sharedLinksHandler(req, res);
  }

  const sharedLinksMatch = pathname.match(/^\/api\/shared-links\/([^/]+)$/);
  if (sharedLinksMatch && method === 'GET') {
    const token = decodeURIComponent(sharedLinksMatch[1]);
    return sharedLinksTokenHandler(req, res, token);
  }

  if (pathname === '/api/billing' && (method === 'GET' || method === 'PATCH')) {
    return billingHandler(req, res);
  }

  if (pathname === '/api/notifications' && method === 'GET') {
    return notificationsHandler(req, res);
  }

  const notificationMatch = pathname.match(/^\/api\/notifications\/([^/]+)$/);
  if (notificationMatch && method === 'PATCH') {
    const id = decodeURIComponent(notificationMatch[1]);
    return notificationsIdHandler(req, res, id);
  }

  if (pathname === '/api/app-logs' && method === 'POST') {
    return appLogsHandler(req, res);
  }

  if (pathname === '/api/verification-items' && method === 'POST') {
    return verificationItemsHandler(req, res);
  }

  fail(res, 404, 'not_found', 'Route not found', {
    method,
    path: pathname,
  });
}
