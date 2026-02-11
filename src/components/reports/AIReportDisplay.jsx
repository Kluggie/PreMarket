import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  CheckCircle2, XCircle, AlertTriangle, MessageSquare, 
  Sparkles, ChevronRight 
} from 'lucide-react';

// FitCard Report Renderer (Profile Matching Template)
export function FitCardReportDisplay({ report }) {
  if (!report?.output_report_json) return null;

  return (
    <div className="space-y-6">
      <Card className="border-0 shadow-sm bg-gradient-to-br from-purple-50 to-indigo-50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-600" />
              Profile Evaluation Report
            </CardTitle>
            <Badge variant="outline">Shared with both parties</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="p-4 bg-white rounded-lg">
              <p className="text-sm text-slate-600">Mode</p>
              <p className="text-xl font-bold">{report.mode_value}</p>
            </div>
            <div className="p-4 bg-white rounded-lg">
              <p className="text-sm text-slate-600">Match Level</p>
              <p className="text-xl font-bold capitalize">{report.output_report_json.summary?.fit_level || 'Unknown'}</p>
            </div>
          </div>

          {report.output_report_json.must_haves_check && (
            <div className="mb-4 p-4 bg-white rounded-lg">
              <h4 className="font-semibold mb-2">Must-Haves Check</h4>
              <p className="text-2xl font-bold text-blue-600">
                {report.output_report_json.must_haves_check.satisfied_count} / {report.output_report_json.must_haves_check.total_count}
              </p>
              {report.output_report_json.must_haves_check.missing_items?.length > 0 && (
                <div className="mt-3 space-y-2">
                  {report.output_report_json.must_haves_check.missing_items.map((item, idx) => (
                    <div key={idx} className="text-sm p-2 bg-red-50 border border-red-100 rounded">
                      {item.text}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {report.output_report_json.summary?.top_strengths?.length > 0 && (
            <div className="mb-4">
              <h4 className="font-semibold mb-2 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                Top Match Reasons
              </h4>
              <div className="space-y-2">
                {report.output_report_json.summary.top_strengths.map((strength, idx) => (
                  <div key={idx} className="p-3 bg-green-50 border border-green-100 rounded-lg">
                    <p className="text-sm text-slate-800">{strength.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {report.output_report_json.summary?.key_gaps?.length > 0 && (
            <div className="mb-4">
              <h4 className="font-semibold mb-2 flex items-center gap-2">
                <XCircle className="w-4 h-4 text-red-600" />
                Key Gaps
              </h4>
              <div className="space-y-2">
                {report.output_report_json.summary.key_gaps.map((gap, idx) => (
                  <div key={idx} className="p-3 bg-red-50 border border-red-100 rounded-lg">
                    <p className="text-sm text-slate-800">{gap.text}</p>
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