import { fail } from '../server/_lib/api-response.js';
import { randomUUID } from 'node:crypto';
import { json } from '../server/_lib/http.js';
import healthHandler from '../server/routes/health.js';
import healthAuthHandler from '../server/routes/health/auth.js';
import healthVertexHandler from '../server/routes/health/vertex.js';
import debugVertexHandler from '../server/routes/debug/vertex.js';
import debugDbHandler from '../server/routes/debug/db.js';
import stripeWebhookHandler from '../server/routes/stripeWebhook.js';
import authMeHandler from '../server/routes/auth/me.js';
import authLogoutHandler from '../server/routes/auth/logout.js';
import authCsrfHandler from '../server/routes/auth/csrf.js';
import authGoogleVerifyHandler from '../server/routes/auth/google/verify.js';
import emailSendHandler from '../server/routes/email/send.js';
import proposalsHandler from '../server/routes/proposals/index.js';
import proposalsIdHandler from '../server/routes/proposals/[id].js';
import proposalResponsesHandler from '../server/routes/proposals/[id]/responses.js';
import proposalSendHandler from '../server/routes/proposals/[id]/send.js';
import proposalEvaluateHandler from '../server/routes/proposals/[id]/evaluate.js';
import proposalEvaluationsHandler from '../server/routes/proposals/[id]/evaluations.js';
import proposalArchiveHandler from '../server/routes/proposals/[id]/archive.js';
import proposalUnarchiveHandler from '../server/routes/proposals/[id]/unarchive.js';
import sharedLinksHandler from '../server/routes/shared-links/index.js';
import sharedLinksTokenHandler from '../server/routes/shared-links/[token].js';
import sharedLinksConsumeHandler from '../server/routes/shared-links/[token]/consume.js';
import sharedLinksRespondHandler from '../server/routes/shared-links/[token]/respond.js';
import sharedReportsHandler from '../server/routes/shared-reports/index.js';
import sharedReportsTokenHandler from '../server/routes/shared-reports/[token].js';
import sharedReportsSendHandler from '../server/routes/shared-reports/[token]/send.js';
import sharedReportsRevokeHandler from '../server/routes/shared-reports/[token]/revoke.js';
import sharedReportsRespondHandler from '../server/routes/shared-reports/[token]/respond.js';
import sharedReportTokenHandler from '../server/routes/shared-report/[token].js';
import sharedReportWorkspaceHandler from '../server/routes/shared-report/[token]/workspace.js';
import sharedReportDraftHandler from '../server/routes/shared-report/[token]/draft.js';
import sharedReportEvaluateHandler from '../server/routes/shared-report/[token]/evaluate.js';
import sharedReportCoachHandler from '../server/routes/shared-report/[token]/coach.js';
import sharedReportCompanyBriefHandler from '../server/routes/shared-report/[token]/company-brief.js';
import sharedReportSendBackHandler from '../server/routes/shared-report/[token]/send-back.js';
import sharedReportDownloadPdfHandler from '../server/routes/shared-report/[token]/download-pdf.js';
import sharedReportDownloadProposalPdfHandler from '../server/routes/shared-report/[token]/download-proposal-pdf.js';
import sharedReportVerifyStartHandler from '../server/routes/shared-report/[token]/verify/start.js';
import sharedReportVerifyConfirmHandler from '../server/routes/shared-report/[token]/verify/confirm.js';
import vertexSmokeHandler from '../server/routes/vertex/smoke.js';
import billingHandler from '../server/routes/billing/index.js';
import billingStatusHandler from '../server/routes/billing/status.js';
import billingCheckoutHandler from '../server/routes/billing/checkout.js';
import billingCancelHandler from '../server/routes/billing/cancel.js';
import notificationsHandler from '../server/routes/notifications/index.js';
import notificationsIdHandler from '../server/routes/notifications/[id].js';
import appLogsHandler from '../server/routes/app-logs/index.js';
import verificationItemsHandler from '../server/routes/verification-items/index.js';
import dashboardSummaryHandler from '../server/routes/dashboard/summary.js';
import dashboardActivityHandler from '../server/routes/dashboard/activity.js';
import contactHandler from '../server/routes/contact/index.js';
import contactRequestsHandler from '../server/routes/contact-requests/index.js';
import betaCountHandler from '../server/routes/beta/count.js';
import betaApplyHandler from '../server/routes/beta/apply.js';
import betaSignupsHandler from '../server/routes/beta-signups/index.js';
import betaSignupsStatsHandler from '../server/routes/beta-signups/stats.js';
import templatesHandler from '../server/routes/templates/index.js';
import templatesUseHandler from '../server/routes/templates/[id]/use.js';
import templatesViewHandler from '../server/routes/templates/[id]/view.js';
import documentsExtractHandler from '../server/routes/documents/extract.js';
import documentsIndexHandler from '../server/routes/documents/index.js';
import documentsIdHandler from '../server/routes/documents/[id].js';
import accountProfileHandler from '../server/routes/account/profile.js';
import accountOrganizationsHandler from '../server/routes/account/organizations.js';
import accountOrganizationsIdHandler from '../server/routes/account/organizations/[id].js';
import accountEmailConfigStatusHandler from '../server/routes/account/email-config-status.js';
import adminProposalRecoveryHandler from '../server/routes/admin/proposals/recovery.js';
import accountVerificationStatusHandler from '../server/routes/account/verification/status.js';
import accountVerificationSendHandler from '../server/routes/account/verification/send.js';
import accountVerificationConfirmHandler from '../server/routes/account/verification/confirm.js';
import securitySessionsHandler from '../server/routes/security/sessions.js';
import securitySessionsRevokeHandler from '../server/routes/security/sessions/revoke.js';
import securitySessionsRevokeAllHandler from '../server/routes/security/sessions/revoke-all.js';
import securityActivityHandler from '../server/routes/security/activity.js';
import securityMfaStatusHandler from '../server/routes/security/mfa/status.js';
import securityMfaEnrollStartHandler from '../server/routes/security/mfa/enroll/start.js';
import securityMfaEnrollConfirmHandler from '../server/routes/security/mfa/enroll/confirm.js';
import securityMfaChallengeHandler from '../server/routes/security/mfa/challenge.js';
import securityMfaDisableHandler from '../server/routes/security/mfa/disable.js';
import securityMfaBackupRegenerateHandler from '../server/routes/security/mfa/backup/regenerate.js';
import directorySearchHandler from '../server/routes/directory/search.js';
import directoryDetailHandler from '../server/routes/directory/detail.js';
import publicTemplatesHandler from '../server/routes/public/templates.js';

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

function getRequestId(req: VercelRequest) {
  const headerValue = req?.query?.requestId || req?.query?.request_id || req?.query?.['x-request-id'];
  if (headerValue) {
    return String(Array.isArray(headerValue) ? headerValue[0] : headerValue).trim() || randomUUID();
  }

  const rawHeader = (req as any)?.headers?.['x-request-id'];
  const normalized = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  return String(normalized || '').trim() || randomUUID();
}

let documentComparisonRouteHandlersPromise:
  | Promise<{
      documentComparisonsHandler: any;
      documentComparisonsExtractUrlHandler: any;
      documentComparisonsIdHandler: any;
      documentComparisonsEvaluateHandler: any;
      documentComparisonsCoachHandler: any;
      documentComparisonsCompanyContextHandler: any;
      documentComparisonsCompanyBriefHandler: any;
      documentComparisonsDownloadJsonHandler: any;
      documentComparisonsDownloadInputsHandler: any;
      documentComparisonsDownloadPdfHandler: any;
      documentComparisonsDownloadProposalPdfHandler: any;
    }>
  | null = null;

async function getDocumentComparisonRouteHandlers() {
  if (!documentComparisonRouteHandlersPromise) {
    documentComparisonRouteHandlersPromise = Promise.all([
      import('../server/routes/document-comparisons/index.js'),
      import('../server/routes/document-comparisons/extract-url.js'),
      import('../server/routes/document-comparisons/[id].js'),
      import('../server/routes/document-comparisons/[id]/evaluate.js'),
      import('../server/routes/document-comparisons/[id]/coach.js'),
      import('../server/routes/document-comparisons/[id]/company-context.js'),
      import('../server/routes/document-comparisons/[id]/company-brief.js'),
      import('../server/routes/document-comparisons/[id]/download-json.js'),
      import('../server/routes/document-comparisons/[id]/download-inputs.js'),
      import('../server/routes/document-comparisons/[id]/download-pdf.js'),
      import('../server/routes/document-comparisons/[id]/download-proposal-pdf.js'),
    ]).then(
      ([
        documentComparisonsModule,
        extractUrlModule,
        idModule,
        evaluateModule,
        coachModule,
        companyContextModule,
        companyBriefModule,
        downloadJsonModule,
        downloadInputsModule,
        downloadPdfModule,
        downloadProposalPdfModule,
      ]) => ({
        documentComparisonsHandler: documentComparisonsModule.default,
        documentComparisonsExtractUrlHandler: extractUrlModule.default,
        documentComparisonsIdHandler: idModule.default,
        documentComparisonsEvaluateHandler: evaluateModule.default,
        documentComparisonsCoachHandler: coachModule.default,
        documentComparisonsCompanyContextHandler: companyContextModule.default,
        documentComparisonsCompanyBriefHandler: companyBriefModule.default,
        documentComparisonsDownloadJsonHandler: downloadJsonModule.default,
        documentComparisonsDownloadInputsHandler: downloadInputsModule.default,
        documentComparisonsDownloadPdfHandler: downloadPdfModule.default,
        documentComparisonsDownloadProposalPdfHandler: downloadProposalPdfModule.default,
      }),
    );
  }

  return documentComparisonRouteHandlersPromise;
}

export default async function handler(req: any, res: any) {
  const method = String(req.method || 'GET').toUpperCase();
  const pathname = getPathname(req);
  const requestId = getRequestId(req);

  stripRouterPathQuery(req);

  try {

  if (pathname === '/api/health' && method === 'GET') {
    return healthHandler(req, res);
  }

  if (pathname === '/api/health/auth' && method === 'GET') {
    return healthAuthHandler(req, res);
  }

  if (pathname === '/api/health/vertex' && method === 'GET') {
    return healthVertexHandler(req, res);
  }

  if (pathname === '/api/debug/vertex' && method === 'GET') {
    return debugVertexHandler(req, res);
  }

  if (pathname === '/api/debug/db' && method === 'GET') {
    return debugDbHandler(req, res);
  }

  if (pathname === '/api/stripeWebhook' && method === 'POST') {
    return stripeWebhookHandler(req, res);
  }

  if (pathname === '/api/auth/me' && method === 'GET') {
    return authMeHandler(req, res);
  }

  if (pathname === '/api/me' && method === 'GET') {
    return authMeHandler(req, res);
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    return authLogoutHandler(req, res);
  }

  if (pathname === '/api/auth/csrf' && method === 'GET') {
    return authCsrfHandler(req, res);
  }

  if (pathname === '/api/csrf' && method === 'GET') {
    return authCsrfHandler(req, res);
  }

  if (pathname === '/api/auth/google/verify' && method === 'POST') {
    return authGoogleVerifyHandler(req, res);
  }

  if (pathname === '/api/email/send' && method === 'POST') {
    return emailSendHandler(req, res);
  }

  if (pathname === '/api/vertex/smoke' && (method === 'GET' || method === 'POST')) {
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

  if (pathname === '/api/public/templates' && method === 'GET') {
    return publicTemplatesHandler(req, res);
  }

  if (pathname === '/api/contact-requests' && method === 'POST') {
    return contactRequestsHandler(req, res);
  }

  if (pathname === '/api/contact' && method === 'POST') {
    return contactHandler(req, res);
  }

  if (pathname === '/api/admin/proposals/recovery' && (method === 'GET' || method === 'POST')) {
    return adminProposalRecoveryHandler(req, res);
  }

  if (pathname === '/api/beta-signups/stats' && method === 'GET') {
    return betaSignupsStatsHandler(req, res);
  }

  if (pathname === '/api/beta-signups' && (method === 'GET' || method === 'POST')) {
    return betaSignupsHandler(req, res);
  }

  if (pathname === '/api/beta/count' && method === 'GET') {
    return betaCountHandler(req, res);
  }

  if (pathname === '/api/beta/apply' && method === 'POST') {
    return betaApplyHandler(req, res);
  }

  const proposalResponsesMatch = pathname.match(/^\/api\/proposals\/([^/]+)\/responses$/);
  if (proposalResponsesMatch && ['GET', 'PUT'].includes(method)) {
    const id = decodeURIComponent(proposalResponsesMatch[1]);
    return proposalResponsesHandler(req, res, id);
  }

  const proposalSendMatch = pathname.match(/^\/api\/proposals\/([^/]+)\/send$/);
  if (proposalSendMatch && method === 'POST') {
    const id = decodeURIComponent(proposalSendMatch[1]);
    return proposalSendHandler(req, res, id);
  }

  const proposalEvaluateMatch = pathname.match(/^\/api\/proposals\/([^/]+)\/evaluate$/);
  if (proposalEvaluateMatch && method === 'POST') {
    const id = decodeURIComponent(proposalEvaluateMatch[1]);
    return proposalEvaluateHandler(req, res, id);
  }

  const proposalEvaluationsMatch = pathname.match(/^\/api\/proposals\/([^/]+)\/evaluations$/);
  if (proposalEvaluationsMatch && method === 'GET') {
    const id = decodeURIComponent(proposalEvaluationsMatch[1]);
    return proposalEvaluationsHandler(req, res, id);
  }

  const proposalArchiveMatch = pathname.match(/^\/api\/proposals\/([^/]+)\/archive$/);
  if (proposalArchiveMatch && method === 'PATCH') {
    const id = decodeURIComponent(proposalArchiveMatch[1]);
    return proposalArchiveHandler(req, res, id);
  }

  const proposalUnarchiveMatch = pathname.match(/^\/api\/proposals\/([^/]+)\/unarchive$/);
  if (proposalUnarchiveMatch && method === 'PATCH') {
    const id = decodeURIComponent(proposalUnarchiveMatch[1]);
    return proposalUnarchiveHandler(req, res, id);
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

  if (pathname === '/api/sharedReports' && (method === 'GET' || method === 'POST')) {
    return sharedReportsHandler(req, res);
  }

  const sharedReportsMatch = pathname.match(/^\/api\/sharedReports\/([^/]+)$/);
  if (sharedReportsMatch && method === 'GET') {
    const token = decodeURIComponent(sharedReportsMatch[1]);
    return sharedReportsTokenHandler(req, res, token);
  }

  const sharedReportsSendMatch = pathname.match(/^\/api\/sharedReports\/([^/]+)\/send$/);
  if (sharedReportsSendMatch && method === 'POST') {
    const token = decodeURIComponent(sharedReportsSendMatch[1]);
    return sharedReportsSendHandler(req, res, token);
  }

  const sharedReportsRevokeMatch = pathname.match(/^\/api\/sharedReports\/([^/]+)\/revoke$/);
  if (sharedReportsRevokeMatch && method === 'POST') {
    const token = decodeURIComponent(sharedReportsRevokeMatch[1]);
    return sharedReportsRevokeHandler(req, res, token);
  }

  const sharedReportsRespondMatch = pathname.match(/^\/api\/sharedReports\/([^/]+)\/respond$/);
  if (sharedReportsRespondMatch && method === 'POST') {
    const token = decodeURIComponent(sharedReportsRespondMatch[1]);
    return sharedReportsRespondHandler(req, res, token);
  }

  const sharedReportWorkspaceMatch = pathname.match(/^\/api\/shared-report\/([^/]+)\/workspace$/);
  if (sharedReportWorkspaceMatch && method === 'GET') {
    const token = decodeURIComponent(sharedReportWorkspaceMatch[1]);
    return sharedReportWorkspaceHandler(req, res, token);
  }

  const sharedReportDraftMatch = pathname.match(/^\/api\/shared-report\/([^/]+)\/draft$/);
  if (sharedReportDraftMatch && method === 'POST') {
    const token = decodeURIComponent(sharedReportDraftMatch[1]);
    return sharedReportDraftHandler(req, res, token);
  }

  const sharedReportEvaluateMatch = pathname.match(/^\/api\/shared-report\/([^/]+)\/evaluate$/);
  if (sharedReportEvaluateMatch && method === 'POST') {
    const token = decodeURIComponent(sharedReportEvaluateMatch[1]);
    return sharedReportEvaluateHandler(req, res, token);
  }

  const sharedReportCoachMatch = pathname.match(/^\/api\/shared-report\/([^/]+)\/coach$/);
  if (sharedReportCoachMatch && method === 'POST') {
    const token = decodeURIComponent(sharedReportCoachMatch[1]);
    return sharedReportCoachHandler(req, res, token);
  }

  const sharedReportCompanyBriefMatch = pathname.match(/^\/api\/shared-report\/([^/]+)\/company-brief$/);
  if (sharedReportCompanyBriefMatch && method === 'POST') {
    const token = decodeURIComponent(sharedReportCompanyBriefMatch[1]);
    return sharedReportCompanyBriefHandler(req, res, token);
  }

  const sharedReportSendBackMatch = pathname.match(/^\/api\/shared-report\/([^/]+)\/send-back$/);
  if (sharedReportSendBackMatch && method === 'POST') {
    const token = decodeURIComponent(sharedReportSendBackMatch[1]);
    return sharedReportSendBackHandler(req, res, token);
  }

  const sharedReportDownloadPdfMatch = pathname.match(/^\/api\/shared-report\/([^/]+)\/download\/pdf$/);
  if (sharedReportDownloadPdfMatch && method === 'GET') {
    const token = decodeURIComponent(sharedReportDownloadPdfMatch[1]);
    return sharedReportDownloadPdfHandler(req, res, token);
  }

  const sharedReportDownloadProposalPdfMatch = pathname.match(
    /^\/api\/shared-report\/([^/]+)\/download\/proposal-pdf$/,
  );
  if (sharedReportDownloadProposalPdfMatch && method === 'GET') {
    const token = decodeURIComponent(sharedReportDownloadProposalPdfMatch[1]);
    return sharedReportDownloadProposalPdfHandler(req, res, token);
  }

  const sharedReportVerifyStartMatch = pathname.match(/^\/api\/shared-report\/([^/]+)\/verify\/start$/);
  if (sharedReportVerifyStartMatch && method === 'POST') {
    const token = decodeURIComponent(sharedReportVerifyStartMatch[1]);
    return sharedReportVerifyStartHandler(req, res, token);
  }

  const sharedReportVerifyConfirmMatch = pathname.match(/^\/api\/shared-report\/([^/]+)\/verify\/confirm$/);
  if (sharedReportVerifyConfirmMatch && method === 'POST') {
    const token = decodeURIComponent(sharedReportVerifyConfirmMatch[1]);
    return sharedReportVerifyConfirmHandler(req, res, token);
  }

  const sharedReportMatch = pathname.match(/^\/api\/shared-report\/([^/]+)$/);
  if (sharedReportMatch && method === 'GET') {
    const token = decodeURIComponent(sharedReportMatch[1]);
    return sharedReportTokenHandler(req, res, token);
  }

  const sharedLinksMatch = pathname.match(/^\/api\/shared-links\/([^/]+)$/);
  if (sharedLinksMatch && method === 'GET') {
    const token = decodeURIComponent(sharedLinksMatch[1]);
    return sharedLinksTokenHandler(req, res, token);
  }

  const sharedLinksConsumeMatch = pathname.match(/^\/api\/shared-links\/([^/]+)\/consume$/);
  if (sharedLinksConsumeMatch && method === 'POST') {
    const token = decodeURIComponent(sharedLinksConsumeMatch[1]);
    return sharedLinksConsumeHandler(req, res, token);
  }

  const sharedLinksRespondMatch = pathname.match(/^\/api\/shared-links\/([^/]+)\/respond$/);
  if (sharedLinksRespondMatch && method === 'POST') {
    const token = decodeURIComponent(sharedLinksRespondMatch[1]);
    return sharedLinksRespondHandler(req, res, token);
  }

  if (pathname === '/api/billing' && (method === 'GET' || method === 'PATCH')) {
    return billingHandler(req, res);
  }

  if (pathname === '/api/billing/status' && method === 'GET') {
    return billingStatusHandler(req, res);
  }

  if (pathname === '/api/billing/checkout' && method === 'POST') {
    return billingCheckoutHandler(req, res);
  }

  if (pathname === '/api/billing/cancel' && method === 'POST') {
    return billingCancelHandler(req, res);
  }

  if (pathname === '/api/document-comparisons' && (method === 'GET' || method === 'POST')) {
    const { documentComparisonsHandler } = await getDocumentComparisonRouteHandlers();
    return documentComparisonsHandler(req, res);
  }

  if (pathname === '/api/document-comparisons/extract-url' && method === 'POST') {
    const { documentComparisonsExtractUrlHandler } = await getDocumentComparisonRouteHandlers();
    return documentComparisonsExtractUrlHandler(req, res);
  }

  if (pathname === '/api/documents/extract' && method === 'POST') {
    return documentsExtractHandler(req, res);
  }

  if (pathname === '/api/documents' && method === 'GET') {
    return documentsIndexHandler(req, res);
  }

  if (pathname === '/api/documents/upload' && method === 'POST') {
    return documentsIndexHandler(req, res);
  }

  const documentsDownloadMatch = pathname.match(/^\/api\/documents\/([^/]+)\/download$/);
  if (documentsDownloadMatch && method === 'GET') {
    const id = decodeURIComponent(documentsDownloadMatch[1]);
    return documentsIdHandler(req, res, id);
  }

  const documentsIdMatch = pathname.match(/^\/api\/documents\/([^/]+)$/);
  if (documentsIdMatch && method === 'DELETE') {
    const id = decodeURIComponent(documentsIdMatch[1]);
    return documentsIdHandler(req, res, id);
  }

  const documentComparisonsEvaluateMatch = pathname.match(
    /^\/api\/document-comparisons\/([^/]+)\/evaluate$/,
  );
  if (documentComparisonsEvaluateMatch && method === 'POST') {
    const id = decodeURIComponent(documentComparisonsEvaluateMatch[1]);
    const { documentComparisonsEvaluateHandler } = await getDocumentComparisonRouteHandlers();
    return documentComparisonsEvaluateHandler(req, res, id);
  }

  const documentComparisonsCoachMatch = pathname.match(
    /^\/api\/document-comparisons\/([^/]+)\/coach$/,
  );
  if (documentComparisonsCoachMatch && method === 'POST') {
    const id = decodeURIComponent(documentComparisonsCoachMatch[1]);
    const { documentComparisonsCoachHandler } = await getDocumentComparisonRouteHandlers();
    return documentComparisonsCoachHandler(req, res, id);
  }

  const documentComparisonsCompanyContextMatch = pathname.match(
    /^\/api\/document-comparisons\/([^/]+)\/company-context$/,
  );
  if (documentComparisonsCompanyContextMatch && method === 'PATCH') {
    const id = decodeURIComponent(documentComparisonsCompanyContextMatch[1]);
    const { documentComparisonsCompanyContextHandler } =
      await getDocumentComparisonRouteHandlers();
    return documentComparisonsCompanyContextHandler(req, res, id);
  }

  const documentComparisonsCompanyBriefMatch = pathname.match(
    /^\/api\/document-comparisons\/([^/]+)\/company-brief$/,
  );
  if (documentComparisonsCompanyBriefMatch && method === 'POST') {
    const id = decodeURIComponent(documentComparisonsCompanyBriefMatch[1]);
    const { documentComparisonsCompanyBriefHandler } =
      await getDocumentComparisonRouteHandlers();
    return documentComparisonsCompanyBriefHandler(req, res, id);
  }

  const documentComparisonsDownloadJsonMatch = pathname.match(
    /^\/api\/document-comparisons\/([^/]+)\/download\/json$/,
  );
  if (documentComparisonsDownloadJsonMatch && method === 'GET') {
    const id = decodeURIComponent(documentComparisonsDownloadJsonMatch[1]);
    const { documentComparisonsDownloadJsonHandler } = await getDocumentComparisonRouteHandlers();
    return documentComparisonsDownloadJsonHandler(req, res, id);
  }

  const documentComparisonsDownloadInputsMatch = pathname.match(
    /^\/api\/document-comparisons\/([^/]+)\/download\/inputs$/,
  );
  if (documentComparisonsDownloadInputsMatch && method === 'GET') {
    const id = decodeURIComponent(documentComparisonsDownloadInputsMatch[1]);
    const { documentComparisonsDownloadInputsHandler } = await getDocumentComparisonRouteHandlers();
    return documentComparisonsDownloadInputsHandler(req, res, id);
  }

  const documentComparisonsDownloadPdfMatch = pathname.match(
    /^\/api\/document-comparisons\/([^/]+)\/download\/pdf$/,
  );
  if (documentComparisonsDownloadPdfMatch && method === 'GET') {
    const id = decodeURIComponent(documentComparisonsDownloadPdfMatch[1]);
    const { documentComparisonsDownloadPdfHandler } = await getDocumentComparisonRouteHandlers();
    return documentComparisonsDownloadPdfHandler(req, res, id);
  }

  const documentComparisonsDownloadProposalPdfMatch = pathname.match(
    /^\/api\/document-comparisons\/([^/]+)\/download\/proposal-pdf$/,
  );
  if (documentComparisonsDownloadProposalPdfMatch && method === 'GET') {
    const id = decodeURIComponent(documentComparisonsDownloadProposalPdfMatch[1]);
    const { documentComparisonsDownloadProposalPdfHandler } = await getDocumentComparisonRouteHandlers();
    return documentComparisonsDownloadProposalPdfHandler(req, res, id);
  }

  const documentComparisonsIdMatch = pathname.match(/^\/api\/document-comparisons\/([^/]+)$/);
  if (documentComparisonsIdMatch && (method === 'GET' || method === 'PATCH')) {
    const id = decodeURIComponent(documentComparisonsIdMatch[1]);
    const { documentComparisonsIdHandler } = await getDocumentComparisonRouteHandlers();
    return documentComparisonsIdHandler(req, res, id);
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

  if (pathname === '/api/account/profile' && (method === 'GET' || method === 'PUT' || method === 'PATCH')) {
    return accountProfileHandler(req, res);
  }

  if (pathname === '/api/account/organizations' && (method === 'GET' || method === 'POST')) {
    return accountOrganizationsHandler(req, res);
  }

  const accountOrganizationsIdMatch = pathname.match(/^\/api\/account\/organizations\/([^/]+)$/);
  if (accountOrganizationsIdMatch && method === 'PATCH') {
    const id = decodeURIComponent(accountOrganizationsIdMatch[1]);
    return accountOrganizationsIdHandler(req, res, id);
  }

  if (pathname === '/api/account/email-config-status' && method === 'GET') {
    return accountEmailConfigStatusHandler(req, res);
  }

  if (pathname === '/api/account/verification/status' && method === 'GET') {
    return accountVerificationStatusHandler(req, res);
  }

  if (pathname === '/api/account/verification/send' && method === 'POST') {
    return accountVerificationSendHandler(req, res);
  }

  if (pathname === '/api/account/verification/confirm' && method === 'POST') {
    return accountVerificationConfirmHandler(req, res);
  }

  if (pathname === '/api/security/sessions' && method === 'GET') {
    return securitySessionsHandler(req, res);
  }

  if (pathname === '/api/security/sessions/revoke' && method === 'POST') {
    return securitySessionsRevokeHandler(req, res);
  }

  if (pathname === '/api/security/sessions/revoke-all' && method === 'POST') {
    return securitySessionsRevokeAllHandler(req, res);
  }

  if (pathname === '/api/security/activity' && method === 'GET') {
    return securityActivityHandler(req, res);
  }

  if (pathname === '/api/security/mfa/status' && method === 'GET') {
    return securityMfaStatusHandler(req, res);
  }

  if (pathname === '/api/security/mfa/enroll/start' && method === 'POST') {
    return securityMfaEnrollStartHandler(req, res);
  }

  if (pathname === '/api/security/mfa/enroll/confirm' && method === 'POST') {
    return securityMfaEnrollConfirmHandler(req, res);
  }

  if (pathname === '/api/security/mfa/challenge' && method === 'POST') {
    return securityMfaChallengeHandler(req, res);
  }

  if (pathname === '/api/security/mfa/disable' && method === 'POST') {
    return securityMfaDisableHandler(req, res);
  }

  if (pathname === '/api/security/mfa/backup/regenerate' && method === 'POST') {
    return securityMfaBackupRegenerateHandler(req, res);
  }

  if (pathname === '/api/directory/search' && method === 'GET') {
    return directorySearchHandler(req, res);
  }

  if (pathname === '/api/directory/detail' && method === 'GET') {
    return directoryDetailHandler(req, res);
  }

  fail(res, 404, 'not_found', 'Route not found', {
    method,
    path: pathname,
  });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error || 'unknown_error');
    const name = error instanceof Error ? error.name : 'UnknownError';
    const stack = error instanceof Error ? error.stack || null : null;
    console.error(
      JSON.stringify({
        level: 'error',
        requestId,
        route: '/api/index',
        method,
        path: pathname,
        errorName: name,
        errorMessage: message,
        errorStack: stack,
      }),
    );

    json(res, 500, {
      code: 'internal_error',
      requestId,
    });
  }
}
