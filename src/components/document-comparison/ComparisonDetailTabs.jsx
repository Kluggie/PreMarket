import React from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { BarChart3, Clock, FileText, Loader2, Sparkles } from 'lucide-react';
import {
  hasV2Report,
  getDecisionStatusDetails,
  getConfidencePercent,
  MEDIATION_REVIEW_LABEL,
  MISSING_OR_REDACTED_INFO_LABEL,
  OPEN_QUESTIONS_LABEL,
  parseV2WhyEntry,
  splitV2WhyBodyParagraphs,
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
  noReportMessage = 'No AI mediation review yet.',
  runDetailsHref = '',
  report = {},
  recommendation = '',
  confidenceFallbackScore = null,
  timelineItems = [],
}) {
  const safeReport = report && typeof report === 'object' && !Array.isArray(report) ? report : {};
  const isV2 = hasV2Report(safeReport);
  const reportSections = Array.isArray(safeReport?.sections) ? safeReport.sections : [];
  const reportSectionsFiltered = isV2 ? [] : filterLegacySectionsForDisplay(reportSections);
  const showRunDetailsLink = Boolean(runDetailsHref) && (hasReport || hasEvaluations);
  const normalizedTimelineItems = Array.isArray(timelineItems) ? timelineItems : [];
  const decisionStatus = getDecisionStatusDetails(safeReport);
  const confidencePercent = getConfidencePercent(
    safeReport,
    confidenceFallbackScore ?? safeReport?.similarity_score ?? null,
  );
  const openQuestionsCount = Array.isArray(safeReport.missing) ? safeReport.missing.length : 0;
  const decisionExplanation = asText(decisionStatus.explanation);
  const decisionToneClass =
    decisionStatus.tone === 'success'
      ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
      : decisionStatus.tone === 'warning'
      ? 'bg-amber-100 text-amber-700 border-amber-200'
      : decisionStatus.tone === 'danger'
      ? 'bg-rose-100 text-rose-700 border-rose-200'
      : 'bg-slate-100 text-slate-700 border-slate-200';
  const redactionItems = Array.isArray(safeReport.redactions) ? safeReport.redactions : [];

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
    <div className="space-y-6">
      {isEvaluationRunning ? (
        <Card className="border border-slate-200 shadow-sm">
          <CardContent className="py-6">
            <div className="flex items-center gap-2 text-slate-700">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="font-medium">AI mediation in progress...</span>
            </div>
            <p className="text-sm text-slate-500 mt-2">
              {isPollingTimedOut
                ? 'Still processing. Refresh to check status.'
                : 'The mediation review updates automatically when processing finishes.'}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {isEvaluationNotConfigured ? (
        <Alert className="bg-amber-50 border-amber-200">
          <AlertDescription className="text-amber-900">
            Vertex AI integration is not configured. AI mediation review not available.
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

      {/* Completed evaluation with no visible report content — prevents a silent blank panel.
          This can occur when the server's projection strips all content due to confidentiality
          policy or when an edge-case fallback produces an empty public_report. */}
      {!isEvaluationRunning && !isEvaluationNotConfigured && !isEvaluationFailed && hasEvaluations && !hasReport ? (
        <Card className="border border-slate-200 shadow-sm">
          <CardContent className="py-6 text-slate-600">
            The AI mediation review completed. Detailed report content is not available for this
            evaluation — this can happen if the report was filtered for confidentiality. You may
            re-run the review to generate a new result.
          </CardContent>
        </Card>
      ) : null}

      {hasReport ? (
        <>
          {/* Compact metadata row — lighter alternative to heavy dark strip */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Recommendation</span>
              <Badge variant="outline" className="capitalize">
                {recommendation || safeReport?.fit_level || 'Pending'}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Confidence</span>
              <Badge variant="outline">{confidencePercent}%</Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Status</span>
              <Badge className={decisionToneClass}>{decisionStatus.label}</Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{OPEN_QUESTIONS_LABEL}</span>
              <Badge className="bg-amber-100 text-amber-700 border-amber-200">
                {openQuestionsCount} item{openQuestionsCount !== 1 ? 's' : ''}
              </Badge>
            </div>
            {showRunDetailsLink ? (
              <div className="ml-auto">
                <Link
                  to={runDetailsHref}
                  className="inline-flex items-center text-sm text-slate-500 hover:text-slate-700 gap-1.5"
                >
                  <BarChart3 className="w-3.5 h-3.5" />
                  Run details
                </Link>
              </div>
            ) : null}
          </div>

          {/* Report document — white paper surface */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="px-6 py-7 space-y-7">
              {isV2 ? (
                <div className="space-y-5" data-testid="v2-full-report">
                  {safeReport.why.map((entry, index) => {
                    const { heading, body } = parseV2WhyEntry(entry);
                    const paragraphs = splitV2WhyBodyParagraphs(body);
                    return (
                      <div key={index}>
                        {heading ? (
                          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{heading}</h3>
                        ) : null}
                        <div className="space-y-3">
                          {(paragraphs.length > 0 ? paragraphs : [body]).map((paragraph, paragraphIndex) => (
                            <p key={paragraphIndex} className="text-sm text-slate-700 leading-relaxed">{paragraph}</p>
                          ))}
                        </div>
                        {index < safeReport.why.length - 1 && <div className="mt-5 border-t border-slate-100" />}
                      </div>
                    );
                  })}
                </div>
              ) : reportSectionsFiltered.length > 0 ? (
                <div className="space-y-5">
                  {reportSectionsFiltered.map((section, index) => (
                    <div key={`${section.key || section.heading || 'section'}-${index}`}>
                      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                        {section.heading || section.key || `Section ${index + 1}`}
                      </h3>
                      <ul className="space-y-1.5 text-sm text-slate-700">
                        {(Array.isArray(section.bullets) ? section.bullets : []).map((line, lineIndex) => (
                          <li key={`${index}-${lineIndex}`} className="flex items-start gap-2">
                            <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-slate-400 flex-shrink-0" />
                            {line}
                          </li>
                        ))}
                      </ul>
                      {index < reportSectionsFiltered.length - 1 && <div className="mt-5 border-t border-slate-100" />}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-slate-600">AI mediation review content is not available yet.</p>
              )}

              {/* Open Questions */}
              {isV2 && Array.isArray(safeReport.missing) && safeReport.missing.length > 0 ? (
                <div className="border-t border-slate-100 pt-6" data-testid="v2-missing-info">
                  <h2 className="text-sm font-semibold text-slate-700 mb-3">{OPEN_QUESTIONS_LABEL}</h2>
                  <ul className="space-y-2.5">
                    {safeReport.missing.map((item, index) => (
                      <li key={index} className="flex items-start gap-2.5 text-sm text-slate-700">
                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {isV2 && redactionItems.length > 0 ? (
                <div className="border-t border-slate-100 pt-6" data-testid="v2-redacted-info">
                  <h2 className="text-sm font-semibold text-slate-700 mb-3">{MISSING_OR_REDACTED_INFO_LABEL}</h2>
                  <ul className="space-y-2.5">
                    {redactionItems.map((item, index) => (
                      <li key={index} className="flex items-start gap-2.5 text-sm text-slate-700">
                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-slate-400 flex-shrink-0" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {decisionExplanation ? (
                <div className="border-t border-slate-100 pt-6" data-testid="decision-explanation">
                  <h2 className="text-sm font-semibold text-slate-700 mb-3">Decision Explanation</h2>
                  <p className="text-sm text-slate-700 leading-relaxed">{decisionExplanation}</p>
                </div>
              ) : null}

            </div>
          </div>
        </>
      ) : null}
    </div>

    {/* Activity Timeline sidebar */}
    <Card className="border border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle>Activity Timeline</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {normalizedTimelineItems.length > 0 ? (
          normalizedTimelineItems.map((item, index) => {
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
  title = 'Opportunity',
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
          label: asText(doc?.label) || 'Opportunity',
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
  activeTab = 'report',
  onTabChange,
  hasReportBadge = false,
  tabOrder = ['report', 'details'],
  detailsTabLabel = 'Opportunity',
  aiReportProps = {},
  proposalDetailsProps = {},
}) {
  const orderedTabs = Array.isArray(tabOrder)
    ? tabOrder.filter((tab, index, source) => ['report', 'details'].includes(tab) && source.indexOf(tab) === index)
    : ['report', 'details'];

  return (
    <Tabs value={activeTab} onValueChange={onTabChange}>
      <TabsList className="bg-white border border-slate-200 p-1">
        {orderedTabs.map((tab) => {
          if (tab === 'report') {
            return (
              <TabsTrigger
                key="report"
                value="report"
                className="data-[state=active]:bg-slate-900 data-[state=active]:text-white"
              >
                <BarChart3 className="w-4 h-4 mr-2" />
                {MEDIATION_REVIEW_LABEL}
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

      <TabsContent value="report" className="mt-6" aria-label={MEDIATION_REVIEW_LABEL}>
        <ComparisonAiReportTab {...aiReportProps} />
      </TabsContent>

      <TabsContent value="details" className="mt-6">
        <ComparisonProposalDetailsTab title={detailsTabLabel} {...proposalDetailsProps} />
      </TabsContent>
    </Tabs>
  );
}
