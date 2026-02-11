import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { 
  CheckCircle2, XCircle, AlertTriangle, MessageSquare, 
  Sparkles, ChevronRight, Copy, Check, Info
} from 'lucide-react';
import { toast } from 'sonner';

// Helper to compute data completeness
function computeDataCompleteness(report) {
  const json = report?.output_report_json || {};
  
  // Count available data points
  let total = 0;
  let completed = 0;
  
  // Must-haves check
  if (json.must_haves_check) {
    total += json.must_haves_check.total_count || 0;
    completed += json.must_haves_check.satisfied_count || 0;
  }
  
  // Check if we have Party A data (strengths present)
  const hasPartyA = json.summary?.top_strengths?.length > 0;
  total += 1;
  if (hasPartyA) completed += 1;
  
  // Check if we have Party B data (gaps or flags present)
  const hasPartyB = (json.summary?.key_gaps?.length > 0) || (json.flags?.length > 0);
  total += 1;
  if (hasPartyB) completed += 1;
  
  if (total === 0) return { percent: 0, message: 'No data available' };
  
  const percent = Math.round((completed / total) * 100);
  
  if (percent < 40) {
    return { percent, message: 'Party B criteria missing' };
  } else if (percent < 70) {
    return { percent, message: 'Incomplete data' };
  }
  return { percent, message: 'Data complete' };
}

// Helper to determine overall status
function getEvaluationStatus(report) {
  const json = report?.output_report_json || {};
  const completeness = computeDataCompleteness(report);
  
  const fitLevel = json.summary?.fit_level;
  const isComplete = completeness.percent >= 70;
  const hasGaps = json.summary?.key_gaps?.length > 0;
  const hasFlags = json.flags?.length > 0;
  
  if (!isComplete) {
    return {
      status: 'Incomplete',
      confidence: 'Low (insufficient data)',
      primaryBlocker: completeness.message,
      color: 'bg-amber-50 border-amber-200',
      badgeColor: 'bg-amber-600'
    };
  }
  
  if (fitLevel === 'high') {
    return {
      status: 'Strong Match',
      confidence: 'High',
      primaryBlocker: null,
      color: 'bg-green-50 border-green-200',
      badgeColor: 'bg-green-600'
    };
  }
  
  if (fitLevel === 'medium' || fitLevel === 'med') {
    return {
      status: 'Moderate Match',
      confidence: hasGaps || hasFlags ? 'Medium' : 'Medium-High',
      primaryBlocker: hasGaps ? json.summary.key_gaps[0]?.text : null,
      color: 'bg-blue-50 border-blue-200',
      badgeColor: 'bg-blue-600'
    };
  }
  
  return {
    status: 'Insufficient Match',
    confidence: 'Medium-Low',
    primaryBlocker: hasGaps ? json.summary.key_gaps[0]?.text : 'Multiple gaps identified',
    color: 'bg-slate-50 border-slate-200',
    badgeColor: 'bg-slate-600'
  };
}

// FitCard Report Renderer (Profile Matching Template)
export function FitCardReportDisplay({ report }) {
  const [copiedQuestion, setCopiedQuestion] = useState(null);
  
  if (!report?.output_report_json) return null;
  
  const json = report.output_report_json;
  const status = getEvaluationStatus(report);
  const completeness = computeDataCompleteness(report);
  
  // Sort flags by severity
  const sortedFlags = [...(json.flags || [])].sort((a, b) => {
    const severityOrder = { high: 0, med: 1, low: 2 };
    return (severityOrder[a.severity] || 3) - (severityOrder[b.severity] || 3);
  });
  
  const flagCounts = {
    high: sortedFlags.filter(f => f.severity === 'high').length,
    med: sortedFlags.filter(f => f.severity === 'med').length,
    low: sortedFlags.filter(f => f.severity === 'low').length
  };

  const handleCopyQuestion = (question, idx) => {
    navigator.clipboard.writeText(question);
    setCopiedQuestion(idx);
    toast.success('Question copied to clipboard');
    setTimeout(() => setCopiedQuestion(null), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Status Banner */}
      <Card className={`border shadow-sm ${status.color}`}>
        <CardContent className="py-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <Badge className={`${status.badgeColor} text-white px-3 py-1`}>{status.status}</Badge>
                <Badge variant="outline" className="text-xs">Shared with both parties</Badge>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm mt-3">
                <div>
                  <span className="text-slate-600">Confidence:</span>
                  <span className="font-semibold ml-2">{status.confidence}</span>
                </div>
                <div>
                  <span className="text-slate-600">Data Completeness:</span>
                  <span className="font-semibold ml-2">{completeness.percent}%</span>
                </div>
                {status.primaryBlocker && (
                  <div className="col-span-2">
                    <span className="text-slate-600">Primary Blocker:</span>
                    <span className="font-semibold ml-2">{status.primaryBlocker}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Info className="w-5 h-5 text-slate-400" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Executive Summary */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-4">
          <CardTitle className="text-xl font-bold">Executive Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-slate-600 mb-2">Overall Result</p>
            <p className="text-base font-medium">{status.status} • Confidence: {status.confidence}</p>
          </div>
          
          {json.summary?.top_strengths?.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-slate-600 mb-2">Top Match Reasons</p>
              <ul className="space-y-1.5">
                {json.summary.top_strengths.slice(0, 2).map((strength, idx) => (
                  <li key={idx} className="text-sm flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                    <span>{strength.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          
          {json.summary?.key_gaps?.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-slate-600 mb-2">Key Gaps</p>
              <ul className="space-y-1.5">
                {json.summary.key_gaps.slice(0, 2).map((gap, idx) => (
                  <li key={idx} className="text-sm flex items-start gap-2">
                    <XCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                    <span>{gap.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          
          <div className="pt-2 border-t">
            <p className="text-sm font-semibold text-slate-600 mb-2">Recommended Next Step</p>
            <p className="text-sm text-blue-600 font-medium">
              {completeness.percent < 70 
                ? 'Request Party B criteria to complete evaluation'
                : json.followup_questions?.length > 0
                  ? 'Review follow-up questions to refine match assessment'
                  : 'Proceed with direct engagement'}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Data Completeness Indicator */}
      <Card className="border-0 shadow-sm">
        <CardContent className="py-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-slate-700">Data Completeness</span>
            <span className="text-sm font-bold">{completeness.percent}%</span>
          </div>
          <Progress value={completeness.percent} className="h-2" />
          <p className="text-xs text-slate-500 mt-2">{completeness.message}</p>
        </CardContent>
      </Card>

      {/* Must-Haves Check */}
      {json.must_haves_check && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg font-bold">Must-Haves Check</CardTitle>
          </CardHeader>
          <CardContent>

          <div className="flex items-center justify-between mb-4">
            <p className="text-3xl font-bold text-blue-600">
              {json.must_haves_check.satisfied_count} / {json.must_haves_check.total_count}
            </p>
            <Badge variant="outline" className="text-sm">
              {Math.round((json.must_haves_check.satisfied_count / json.must_haves_check.total_count) * 100)}% satisfied
            </Badge>
          </div>
          {json.must_haves_check.missing_items?.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-600 mb-2">Missing Requirements</p>
              {json.must_haves_check.missing_items.map((item, idx) => (
                <div key={idx} className="text-sm p-3 bg-red-50 border border-red-100 rounded-lg">
                  {item.text}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {/* Top Match Reasons */}
      {json.summary?.top_strengths?.length > 0 && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              Top Match Reasons
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {json.summary.top_strengths.map((strength, idx) => (
                <div key={idx} className="p-4 bg-green-50 border border-green-200 rounded-lg">
                  <p className="text-sm font-medium text-slate-800">{strength.text}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Key Gaps */}
      {json.summary?.key_gaps?.length > 0 && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <XCircle className="w-5 h-5 text-red-600" />
              Key Gaps
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {json.summary.key_gaps.map((gap, idx) => (
                <div key={idx} className="p-4 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm font-medium text-slate-800">{gap.text}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

          {report.output_report_json.flags?.length > 0 && (
            <div className="mb-4">
              <h4 className="font-semibold mb-2 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                Flags & Concerns
              </h4>
              <div className="space-y-2">
                {report.output_report_json.flags.map((flag, idx) => (
                  <div key={idx} className={`p-3 rounded-lg border ${
                    flag.severity === 'high' ? 'bg-red-50 border-red-200' :
                    flag.severity === 'med' ? 'bg-amber-50 border-amber-200' :
                    'bg-blue-50 border-blue-200'
                  }`}>
                    <div className="flex items-start gap-2">
                      <Badge className={
                        flag.severity === 'high' ? 'bg-red-600' :
                        flag.severity === 'med' ? 'bg-amber-600' :
                        'bg-blue-600'
                      }>
                        {flag.severity}
                      </Badge>
                      <div className="flex-1">
                        <p className="font-medium text-sm">{flag.title}</p>
                        <p className="text-sm text-slate-600 mt-1">{flag.detail}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {report.output_report_json.followup_questions?.length > 0 && (
            <div>
              <h4 className="font-semibold mb-2 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-blue-600" />
                Follow-up Questions
              </h4>
              <div className="space-y-2">
                {report.output_report_json.followup_questions.map((q, idx) => (
                  <div key={idx} className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    <div className="flex items-start gap-2">
                      <Badge variant="outline" className="text-xs">{q.priority}</Badge>
                      <div className="flex-1">
                        <p className="text-sm font-medium">{q.question_text}</p>
                        <p className="text-xs text-slate-600 mt-1">{q.why_this_matters}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Shared Finance Report Renderer
export function SharedFinanceReportDisplay({ report }) {
  if (!report?.output_report_json) return null;

  return (
    <div className="space-y-6">
      <Card className="border-0 shadow-sm bg-gradient-to-br from-emerald-50 to-blue-50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-emerald-600" />
              Shared Evaluation Report
            </CardTitle>
            <Badge variant="outline">Both parties see this report</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="p-4 bg-white rounded-lg">
              <p className="text-sm text-slate-600">Deal Mode</p>
              <p className="text-xl font-bold">{report.mode_value}</p>
            </div>
            <div className="p-4 bg-white rounded-lg">
              <p className="text-sm text-slate-600">Overall Fit</p>
              <p className="text-xl font-bold capitalize">{report.output_report_json.summary?.fit_level || 'Unknown'}</p>
            </div>
          </div>

          {report.output_report_json.summary?.top_fit_reasons?.length > 0 && (
            <div className="mb-4">
              <h4 className="font-semibold mb-2 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                Top Match Reasons
              </h4>
              <div className="space-y-2">
                {report.output_report_json.summary.top_fit_reasons.map((reason, idx) => (
                  <div key={idx} className="p-3 bg-green-50 border border-green-100 rounded-lg">
                    <p className="text-sm text-slate-800">{reason.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {report.output_report_json.summary?.top_blockers?.length > 0 && (
            <div className="mb-4">
              <h4 className="font-semibold mb-2 flex items-center gap-2">
                <XCircle className="w-4 h-4 text-red-600" />
                Top Blockers
              </h4>
              <div className="space-y-2">
                {report.output_report_json.summary.top_blockers.map((blocker, idx) => (
                  <div key={idx} className="p-3 bg-red-50 border border-red-100 rounded-lg">
                    <p className="text-sm text-slate-800">{blocker.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {report.output_report_json.flags?.length > 0 && (
            <div className="mb-4">
              <h4 className="font-semibold mb-2 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                Flags & Concerns
              </h4>
              <div className="space-y-2">
                {report.output_report_json.flags.map((flag, idx) => (
                  <div key={idx} className={`p-3 rounded-lg border ${
                    flag.severity === 'high' ? 'bg-red-50 border-red-200' :
                    flag.severity === 'med' ? 'bg-amber-50 border-amber-200' :
                    'bg-blue-50 border-blue-200'
                  }`}>
                    <div className="flex items-start gap-2">
                      <Badge className={
                        flag.severity === 'high' ? 'bg-red-600' :
                        flag.severity === 'med' ? 'bg-amber-600' :
                        'bg-blue-600'
                      }>
                        {flag.severity}
                      </Badge>
                      <div className="flex-1">
                        <p className="font-medium text-sm">{flag.title}</p>
                        <p className="text-sm text-slate-600 mt-1">{flag.detail}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {report.output_report_json.followup_questions?.length > 0 && (
            <div>
              <h4 className="font-semibold mb-2 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-blue-600" />
                Follow-up Questions
              </h4>
              <div className="space-y-2">
                {report.output_report_json.followup_questions.map((q, idx) => (
                  <div key={idx} className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    <div className="flex items-start gap-2">
                      <Badge variant="outline" className="text-xs">{q.priority}</Badge>
                      <div className="flex-1">
                        <p className="text-sm font-medium">{q.question_text}</p>
                        <p className="text-xs text-slate-600 mt-1">{q.why_this_matters}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Standard Report Renderer (Non-Finance Templates)
export function StandardReportDisplay({ report }) {
  if (!report?.output_report_json) return null;

  return (
    <div className="space-y-6">
      {/* Quality Metrics */}
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle>Quality Assessment</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-slate-500">Party A Completeness</p>
              <p className="text-2xl font-bold">{Math.round((report.output_report_json.quality?.completeness_a || 0) * 100)}%</p>
            </div>
            <div>
              <p className="text-sm text-slate-500">Party B Completeness</p>
              <p className="text-2xl font-bold">{Math.round((report.output_report_json.quality?.completeness_b || 0) * 100)}%</p>
            </div>
            <div className="col-span-2">
              <p className="text-sm text-slate-500 mb-2">Overall Confidence</p>
              <Progress value={(report.output_report_json.quality?.confidence_overall || 0) * 100} className="h-3" />
              <p className="text-xs text-slate-500 mt-1">
                {report.output_report_json.quality?.confidence_reasoning?.join(' • ')}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle>Executive Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Badge className={
              report.output_report_json.summary?.fit_level === 'high' ? 'bg-green-600' :
              report.output_report_json.summary?.fit_level === 'medium' ? 'bg-amber-600' :
              'bg-slate-600'
            }>
              {(report.output_report_json.summary?.fit_level || 'unknown')} fit
            </Badge>
          </div>
          
          {report.output_report_json.summary?.top_fit_reasons?.length > 0 && (
            <div>
              <p className="font-medium mb-2">Top Match Reasons</p>
              <ul className="space-y-1">
                {report.output_report_json.summary.top_fit_reasons.map((reason, i) => (
                  <li key={i} className="text-sm text-slate-600 flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                    {reason.text}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {report.output_report_json.summary?.top_blockers?.length > 0 && (
            <div>
              <p className="font-medium mb-2">Top Blockers</p>
              <ul className="space-y-1">
                {report.output_report_json.summary.top_blockers.map((blocker, i) => (
                  <li key={i} className="text-sm text-red-600 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    {blocker.text}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {report.output_report_json.summary?.next_actions?.length > 0 && (
            <div>
              <p className="font-medium mb-2">Next Actions</p>
              <ul className="space-y-1">
                {report.output_report_json.summary.next_actions.map((action, i) => (
                  <li key={i} className="text-sm text-blue-600 flex items-start gap-2">
                    <ChevronRight className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    {action}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Flags */}
      {report.output_report_json.flags?.length > 0 && (
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle>Flags & Risks</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {report.output_report_json.flags.map((flag, i) => (
                <div key={i} className={`p-3 rounded-lg ${
                  flag.severity === 'high' ? 'bg-red-50' :
                  flag.severity === 'med' ? 'bg-amber-50' :
                  'bg-slate-50'
                }`}>
                  <div className="flex items-start gap-2">
                    <Badge className={
                      flag.severity === 'high' ? 'bg-red-600' :
                      flag.severity === 'med' ? 'bg-amber-600' :
                      'bg-slate-600'
                    }>
                      {flag.severity}
                    </Badge>
                    <div>
                      <p className="font-medium">{flag.title}</p>
                      <p className="text-sm text-slate-600">{flag.detail}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Follow-up Questions */}
      {report.output_report_json.followup_questions?.length > 0 && (
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle>Recommended Follow-up Questions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {report.output_report_json.followup_questions.map((q, i) => (
                <div key={i} className="p-3 bg-blue-50 rounded-lg">
                  <div className="flex items-start gap-2">
                    <Badge className={
                      q.priority === 'high' ? 'bg-red-600' :
                      q.priority === 'med' ? 'bg-amber-600' :
                      'bg-slate-600'
                    }>
                      {q.priority}
                    </Badge>
                    <div>
                      <p className="font-medium">{q.question_text}</p>
                      <p className="text-sm text-slate-600 mt-1">{q.why_this_matters}</p>
                      <Badge variant="outline" className="text-xs mt-2">To: Party {(q.to_party || '').toUpperCase()}</Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Document Comparison Report Display
export function DocumentComparisonReportDisplay({ reportData }) {
  if (!reportData?.report) return null;

  const report = reportData.report;

  return (
    <div className="space-y-6">
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-blue-600" />
            Document Comparison Report
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {report.summary && (
            <div className="p-4 bg-slate-50 rounded-lg">
              <h4 className="font-semibold mb-2">Summary</h4>
              <p className="text-sm text-slate-700">{report.summary.match_level}</p>
              {report.summary.rationale && (
                <p className="text-sm text-slate-600 mt-2">{report.summary.rationale}</p>
              )}
            </div>
          )}

          {report.alignment_points?.length > 0 && (
            <div>
              <h4 className="font-semibold mb-2 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                Alignment Points
              </h4>
              <div className="space-y-2">
                {report.alignment_points.map((point, idx) => (
                  <div key={idx} className="p-3 bg-green-50 border border-green-100 rounded-lg">
                    <p className="font-medium text-sm">{point.title}</p>
                    <p className="text-sm text-slate-600 mt-1">{point.details}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {report.conflict_or_gaps?.length > 0 && (
            <div>
              <h4 className="font-semibold mb-2 flex items-center gap-2">
                <XCircle className="w-4 h-4 text-red-600" />
                Conflicts & Gaps
              </h4>
              <div className="space-y-2">
                {report.conflict_or_gaps.map((conflict, idx) => (
                  <div key={idx} className="p-3 bg-red-50 border border-red-100 rounded-lg">
                    <p className="font-medium text-sm">{conflict.title}</p>
                    <p className="text-sm text-slate-600 mt-1">{conflict.details}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}