import React from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { BarChart3, Clock, FileText, Loader2, Sparkles } from 'lucide-react';
import {
  hasV2Report,
  parseV2WhyEntry,
  filterLegacySectionsForDisplay,
} from '@/lib/aiReportUtils';

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function toSummaryLines(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (typeof entry === 'string') {
        return asText(entry);
      }
      if (entry && typeof entry === 'object') {
        return asText(entry.text || entry.title || '');
      }
      return '';
    })
    .filter(Boolean);
}

export function buildOverviewBullets(report, maxBullets = 6) {
  const safeReport = report && typeof report === 'object' && !Array.isArray(report) ? report : {};
  const collected = [];
  const pushUnique = (line) => {
    const normalized = asText(line);
    if (!normalized || collected.includes(normalized)) {
      return;
    }
    collected.push(normalized);
  };

  toSummaryLines(safeReport?.summary?.top_fit_reasons).forEach(pushUnique);
  toSummaryLines(safeReport?.summary?.top_blockers).forEach(pushUnique);
  toSummaryLines(safeReport?.summary?.next_actions).forEach(pushUnique);

  if (collected.length === 0) {
    const sections = Array.isArray(safeReport?.sections) ? safeReport.sections : [];
    sections.forEach((section) => {
      const bullets = Array.isArray(section?.bullets) ? section.bullets : [];
      bullets.forEach(pushUnique);
    });
  }

  return collected.slice(0, Math.max(1, Number(maxBullets) || 6));
}

export function renderDocumentReadOnly({ text, html }) {
  const safeText = String(text || '').trim();
  const safeHtml = asText(html);
  const safeHtmlText = stripHtml(safeHtml);

  if (!safeText && !safeHtml) {
    return <p className="text-sm text-slate-500 italic">No text available.</p>;
  }

  if (safeHtml && safeHtmlText) {
    return (
      <div
        className="text-sm text-slate-800 leading-relaxed"
        dangerouslySetInnerHTML={{ __html: safeHtml }}
      />
    );
  }

  return <div className="whitespace-pre-wrap text-sm text-slate-800">{safeText}</div>;
}

const TIMELINE_ICON_MAP = {
  file: FileText,
  clock: Clock,
  sparkles: Sparkles,
};

const TIMELINE_TONE_CLASS_MAP = {
  info: 'bg-blue-100 text-blue-700',
  neutral: 'bg-slate-100 text-slate-700',
  success: 'bg-purple-100 text-purple-700',
  warning: 'bg-amber-100 text-amber-700',
  danger: 'bg-red-100 text-red-700',
};

export function ComparisonOverviewTab({
  recommendation = '',
  overviewBullets = [],
  isEvaluationRunning = false,
  isPollingTimedOut = false,
  isEvaluationNotConfigured = false,
  showConfidentialityWarning = false,
  confidentialityWarningMessage = '',
  confidentialityWarningDetails = '',
  isEvaluationFailed = false,
  evaluationFailureBannerMessage = '',
  hasReport = false,
  noReportMessage = 'No evaluation yet.',
  timelineItems = [],
}) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
      <Card className="border border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle>Overview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isEvaluationRunning ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-slate-700">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="font-medium">Evaluation is running...</span>
              </div>
              <p className="text-sm text-slate-500">
                {isPollingTimedOut
                  ? 'Still processing. Refresh to check for updates.'
                  : 'This page refreshes automatically while evaluation is in progress.'}
              </p>
            </div>
          ) : null}

          {isEvaluationNotConfigured ? (
            <Alert className="bg-amber-50 border-amber-200">
              <AlertDescription className="text-amber-900">
                Vertex AI integration is not configured.
              </AlertDescription>
            </Alert>
          ) : null}

          {showConfidentialityWarning ? (
            <Alert className="bg-amber-50 border-amber-200">
              <AlertDescription className="text-amber-900">
                {confidentialityWarningMessage}
                {confidentialityWarningDetails ? ` ${confidentialityWarningDetails}` : ''}
              </AlertDescription>
            </Alert>
          ) : null}

          {isEvaluationFailed ? (
            <Alert className="bg-red-50 border-red-200">
              <AlertDescription className="text-red-900">
                {evaluationFailureBannerMessage}
              </AlertDescription>
            </Alert>
          ) : null}

          {!isEvaluationRunning && !isEvaluationNotConfigured && !isEvaluationFailed && hasReport ? (
            <>
              <p className="text-slate-700">
                Latest recommendation:{' '}
                <span className="font-semibold capitalize">{recommendation || 'not provided'}</span>
              </p>
              {overviewBullets.length > 0 ? (
                <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700">
                  {overviewBullets.map((line, index) => (
                    <li key={`overview-bullet-${index}`}>{line}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-600">Evaluation completed. Open AI Report for full details.</p>
              )}
            </>
          ) : null}

          {!isEvaluationRunning && !isEvaluationNotConfigured && !isEvaluationFailed && !hasReport ? (
            <p className="text-sm text-slate-600">{noReportMessage}</p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle>Activity Timeline</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {timelineItems.length > 0 ? (
            timelineItems.map((item, index) => {
              const Icon = TIMELINE_ICON_MAP[item?.kind] || FileText;
              const toneClass = TIMELINE_TONE_CLASS_MAP[item?.tone] || TIMELINE_TONE_CLASS_MAP.neutral;
              return (
                <div key={item?.id || `timeline-${index}`} className="flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center ${toneClass}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="font-medium text-slate-900">{item?.title || 'Update'}</p>
                    <p className="text-slate-500">{item?.timestamp || '—'}</p>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="text-sm text-slate-500">No activity yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function ComparisonAiReportTab({
  isEvaluationRunning = false,
  isPollingTimedOut = false,
  isEvaluationNotConfigured = false,
  showConfidentialityWarning = false,
  confidentialityWarningMessage = '',
  confidentialityWarningDetails = '',
  isEvaluationFailed = false,
  evaluationFailureBannerMessage = '',
  hasReport = false,
  hasEvaluations = false,
  noReportMessage = 'No evaluation yet.',
  runDetailsHref = '',
  report = {},
  recommendation = '',
}) {
  const safeReport = report && typeof report === 'object' && !Array.isArray(report) ? report : {};
  const isV2 = hasV2Report(safeReport);
  const reportSections = Array.isArray(safeReport?.sections) ? safeReport.sections : [];
  const reportSectionsFiltered = isV2 ? [] : filterLegacySectionsForDisplay(reportSections);
  const showRunDetailsLink = Boolean(runDetailsHref) && (hasReport || hasEvaluations);

  return (
    <div className="space-y-6">
      {isEvaluationRunning ? (
        <Card className="border border-slate-200 shadow-sm">
          <CardContent className="py-6">
            <div className="flex items-center gap-2 text-slate-700">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="font-medium">Evaluation in progress...</span>
            </div>
            <p className="text-sm text-slate-500 mt-2">
              {isPollingTimedOut
                ? 'Still processing. Refresh to check status.'
                : 'Report updates automatically when processing finishes.'}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {isEvaluationNotConfigured ? (
        <Alert className="bg-amber-50 border-amber-200">
          <AlertDescription className="text-amber-900">
            Vertex AI integration is not configured. AI report not available (AI not configured).
          </AlertDescription>
        </Alert>
      ) : null}

      {showConfidentialityWarning ? (
        <Alert className="bg-amber-50 border-amber-200">
          <AlertDescription className="text-amber-900">
            {confidentialityWarningMessage}
            {confidentialityWarningDetails ? ` ${confidentialityWarningDetails}` : ''}
          </AlertDescription>
        </Alert>
      ) : null}

      {isEvaluationFailed ? (
        <Alert className="bg-red-50 border-red-200">
          <AlertDescription className="text-red-900">
            {evaluationFailureBannerMessage}
          </AlertDescription>
        </Alert>
      ) : null}

      {!isEvaluationRunning && !isEvaluationNotConfigured && !isEvaluationFailed && !hasReport && !hasEvaluations ? (
        <Card className="border border-slate-200 shadow-sm">
          <CardContent className="py-6 text-slate-600">{noReportMessage}</CardContent>
        </Card>
      ) : null}

      {showRunDetailsLink ? (
        <div className="flex justify-end">
          <Link
            to={runDetailsHref}
            className="inline-flex items-center text-sm text-slate-500 hover:text-slate-700 gap-1.5"
          >
            <BarChart3 className="w-3.5 h-3.5" />
            Run details
          </Link>
        </div>
      ) : null}

      {hasReport ? (
        <>
          <Card className="border border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle>Executive Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Badge variant="outline" className="capitalize">
                {recommendation || safeReport?.fit_level || 'No recommendation provided'}
              </Badge>
              {isV2 ? (
                <div className="space-y-4" data-testid="v2-full-report">
                  {safeReport.why.map((entry, index) => {
                    const { heading, body } = parseV2WhyEntry(entry);
                    return (
                      <div
                        key={index}
                        className="rounded-xl border border-slate-200 p-4"
                      >
                        {heading ? (
                          <p className="font-semibold text-slate-900 mb-1">{heading}</p>
                        ) : null}
                        <p className="text-sm text-slate-700 leading-relaxed">{body}</p>
                      </div>
                    );
                  })}
                </div>
              ) : reportSectionsFiltered.length > 0 ? (
                <div className="space-y-4">
                  {reportSectionsFiltered.map((section, index) => (
                    <div
                      key={`${section.key || section.heading || 'section'}-${index}`}
                      className="rounded-xl border border-slate-200 p-4"
                    >
                      <p className="font-semibold text-slate-900 mb-2">
                        {section.heading || section.key || `Section ${index + 1}`}
                      </p>
                      <ul className="list-disc pl-5 space-y-1 text-slate-700">
                        {(Array.isArray(section.bullets) ? section.bullets : []).map((line, lineIndex) => (
                          <li key={`${index}-${lineIndex}`}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-slate-600">AI report content is not available yet.</p>
              )}
            </CardContent>
          </Card>

          {isV2 && Array.isArray(safeReport.missing) && safeReport.missing.length > 0 ? (
            <Card className="border border-slate-200 shadow-sm" data-testid="v2-missing-info">
              <CardHeader>
                <CardTitle>Key Missing Info</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {safeReport.missing.map((item, index) => (
                    <li key={index} className="flex items-start gap-2 text-sm text-slate-700">
                      <span className="mt-0.5 text-amber-500 flex-shrink-0" aria-hidden="true">⚠</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function DocumentPanel({ label, text, html, badges = [] }) {
  const normalizedBadges = Array.isArray(badges)
    ? badges.map((badge) => asText(badge)).filter(Boolean)
    : [];
  return (
    <div className="space-y-2 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-slate-700 font-semibold">
          <FileText className="w-4 h-4" />
          {label}
        </div>
        {normalizedBadges.length > 0 ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {normalizedBadges.map((badge, index) => (
              <Badge key={`${badge}-${index}`} variant="outline">
                {badge}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4 min-h-[320px] max-h-[560px] overflow-auto">
        {renderDocumentReadOnly({ text, html })}
      </div>
    </div>
  );
}

export function ComparisonProposalDetailsTab({
  title = 'Complete Proposal Details',
  description = 'Read-only document content for both information documents.',
  documents = [],
  leftLabel = 'Confidential Information',
  rightLabel = 'Shared Information',
  leftText = '',
  leftHtml = '',
  rightText = '',
  rightHtml = '',
  leftBadges = [],
  rightBadges = [],
}) {
  const normalizedDocuments = Array.isArray(documents)
    ? documents
        .map((doc) => ({
          label: asText(doc?.label) || 'Proposal',
          text: asText(doc?.text),
          html: asText(doc?.html),
          badges: Array.isArray(doc?.badges) ? doc.badges : [],
        }))
        .filter((doc) => doc.label || doc.text || doc.html)
    : [];
  const resolvedDocuments =
    normalizedDocuments.length > 0
      ? normalizedDocuments
      : [
          { label: leftLabel, text: leftText, html: leftHtml, badges: leftBadges },
          { label: rightLabel, text: rightText, html: rightHtml, badges: rightBadges },
        ];

  return (
    <Card className="border border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="text-slate-500">{description}</p>
      </CardHeader>
      <CardContent
        className={`grid grid-cols-1 gap-6 ${resolvedDocuments.length > 1 ? 'lg:grid-cols-2' : ''}`}
      >
        {resolvedDocuments.map((doc, index) => (
          <DocumentPanel
            key={`${doc.label}-${index}`}
            label={doc.label}
            text={doc.text}
            html={doc.html}
            badges={doc.badges}
          />
        ))}
      </CardContent>
    </Card>
  );
}

export function ComparisonDetailTabs({
  activeTab = 'overview',
  onTabChange,
  hasReportBadge = false,
  tabOrder = ['overview', 'report', 'details'],
  detailsTabLabel = 'Complete Proposal Details',
  overviewProps = {},
  aiReportProps = {},
  proposalDetailsProps = {},
}) {
  const orderedTabs = Array.isArray(tabOrder)
    ? tabOrder.filter((tab, index, source) => ['overview', 'report', 'details'].includes(tab) && source.indexOf(tab) === index)
    : ['overview', 'report', 'details'];

  return (
    <Tabs value={activeTab} onValueChange={onTabChange}>
      <TabsList className="bg-white border border-slate-200 p-1">
        {orderedTabs.map((tab) => {
          if (tab === 'overview') {
            return (
              <TabsTrigger
                key="overview"
                value="overview"
                className="data-[state=active]:bg-slate-900 data-[state=active]:text-white"
              >
                <FileText className="w-4 h-4 mr-2" />
                Overview
              </TabsTrigger>
            );
          }

          if (tab === 'report') {
            return (
              <TabsTrigger
                key="report"
                value="report"
                className="data-[state=active]:bg-slate-900 data-[state=active]:text-white"
              >
                <BarChart3 className="w-4 h-4 mr-2" />
                AI Report
                {hasReportBadge ? (
                  <Badge className="ml-2 bg-green-100 text-green-700 text-xs">Complete</Badge>
                ) : null}
              </TabsTrigger>
            );
          }

          return (
            <TabsTrigger
              key="details"
              value="details"
              className="data-[state=active]:bg-slate-900 data-[state=active]:text-white"
            >
              <FileText className="w-4 h-4 mr-2" />
              {detailsTabLabel}
            </TabsTrigger>
          );
        })}
      </TabsList>

      <TabsContent value="overview" className="mt-6">
        <ComparisonOverviewTab {...overviewProps} />
      </TabsContent>

      <TabsContent value="report" className="mt-6">
        <ComparisonAiReportTab {...aiReportProps} />
      </TabsContent>

      <TabsContent value="details" className="mt-6">
        <ComparisonProposalDetailsTab title={detailsTabLabel} {...proposalDetailsProps} />
      </TabsContent>
    </Tabs>
  );
}
