import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { pagesConfig } from '@/pages.config';
import { appLogsClient } from '@/api/appLogsClient';

const BRAND_NAME = 'PreMarket';
const PAGE_TITLE_OVERRIDES = {
  SharedReport: 'Shared Report',
  Proposals: 'Opportunities',
  ProposalDetail: 'Opportunity Detail',
  CreateProposal: 'Create Opportunity',
  CreateProposalWithDrafts: 'Create Opportunity',
  DocumentComparisonCreate: 'Document Comparison',
  DocumentComparisonDetail: 'Document Comparison',
  DocumentComparisonRunDetails: 'Comparison Run Details',
  DirectoryPersonDetail: 'Directory Profile',
  DirectoryOrgDetail: 'Directory Organization',
  ReportViewer: 'Report Viewer',
  GeminiTest: 'AI Test',
};

// Maps new URL path segments to their internal page key equivalents.
// Allows tab titles and analytics logging to work for /Opportunities etc.
const PATH_SEGMENT_ALIASES = {
  opportunities: 'Proposals',
  opportunitydetail: 'ProposalDetail',
  createopportunity: 'CreateProposalWithDrafts',
};

function normalizeRouteToken(value) {
  return String(value || '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

function toPageTitle(pageName, mainPageKey) {
  if (!pageName || pageName === 'Landing' || pageName === mainPageKey) {
    return BRAND_NAME;
  }

  const fallback = pageName
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .trim();
  const label = PAGE_TITLE_OVERRIDES[pageName] || fallback;
  return `${BRAND_NAME} | ${label}`;
}

export default function NavigationTracker() {
  const location = useLocation();
  const { isAuthenticated } = useAuth();
  const { Pages, mainPage } = pagesConfig;
  const mainPageKey = mainPage ?? Object.keys(Pages)[0];

  useEffect(() => {
    const pathname = location.pathname;
    let pageName;

    if (pathname === '/' || pathname === '') {
      pageName = mainPageKey;
    } else {
      const pathSegment = pathname.replace(/^\//, '').split('/')[0];
      const pageKeys = Object.keys(Pages);
      const normalizedPathSegment = normalizeRouteToken(pathSegment);
      const matchedKey = pageKeys.find((key) => normalizeRouteToken(key) === normalizedPathSegment)
        ?? PATH_SEGMENT_ALIASES[normalizedPathSegment]
        ?? null;
      pageName = matchedKey || null;
    }

    document.title = toPageTitle(pageName, mainPageKey);

    if (isAuthenticated && pageName) {
      appLogsClient.logUserInApp(pageName, { trigger: 'navigation', pathname }).catch(() => {
        // Logging is best-effort.
      });
    }
  }, [location.pathname, isAuthenticated, Pages, mainPageKey]);

  return null;
}
