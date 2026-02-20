import React, { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createPageUrl } from '@/utils';
import { sharedLinksClient } from '@/api/sharedLinksClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  ArrowLeft,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Send,
  Sparkles,
  FileText,
  PenSquare,
} from 'lucide-react';

function normalizeText(value) {
  return String(value || '').trim();
}

function useToken() {
  const location = useLocation();
  return useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    return params.get('token') || '';
  }, [location.search]);
}

function buildQuestionSet(rows = []) {
  const byQuestion = new Map();

  rows.forEach((row) => {
    const questionId = normalizeText(row.question_id);
    if (!questionId) return;

    if (!byQuestion.has(questionId)) {
      byQuestion.set(questionId, {
        question_id: questionId,
        current_value: '',
      });
    }

    if (row.entered_by_party === 'b' && row.value) {
      byQuestion.get(questionId).current_value = row.value;
    }
  });

  return Array.from(byQuestion.values());
}

export default function SharedReport() {
  const token = useToken();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [responderEmail, setResponderEmail] = useState('');
  const [questionValues, setQuestionValues] = useState({});

  const {
    data: payload,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['shared-report', token],
    enabled: Boolean(token),
    queryFn: () => sharedLinksClient.getByToken(token, { consume: true, includeDetails: true }),
  });

  const sharedLink = payload?.sharedLink || null;
  const responses = payload?.responses || [];
  const evaluations = payload?.evaluations || [];
  const comparison = payload?.documentComparison || null;
  const proposal = sharedLink?.proposal || null;

  const questions = useMemo(() => buildQuestionSet(responses), [responses]);

  React.useEffect(() => {
    const nextState = {};
    questions.forEach((question) => {
      nextState[question.question_id] = question.current_value || '';
    });
    setQuestionValues(nextState);
  }, [questions]);

  React.useEffect(() => {
    if (sharedLink?.recipientEmail) {
      setResponderEmail(sharedLink.recipientEmail);
    }
  }, [sharedLink?.recipientEmail]);

  const submitMutation = useMutation({
    mutationFn: (runEvaluation = false) =>
      sharedLinksClient.respond(token, {
        responderEmail,
        runEvaluation,
        responses: questions.map((question) => ({
          question_id: question.question_id,
          value: questionValues[question.question_id] || '',
          value_type: 'text',
          visibility: 'full',
        })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries(['shared-report', token]);
      refetch();
    },
  });

  if (!token) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <Alert className="bg-amber-50 border-amber-200">
            <AlertTriangle className="h-4 w-4 text-amber-700" />
            <AlertDescription className="text-amber-800">Missing shared token.</AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <Card className="border-0 shadow-sm">
            <CardContent className="py-16 text-center">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-4" />
              <p className="text-slate-700">Loading shared report...</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (error || !sharedLink) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <Alert className="bg-red-50 border-red-200">
            <AlertTriangle className="h-4 w-4 text-red-700" />
            <AlertDescription className="text-red-800">
              {error?.message || 'Unable to open shared report'}
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  const latestEvaluation = evaluations[0] || null;

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => navigate(createPageUrl('Proposals'))}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div className="flex items-center gap-2">
            <Badge className="bg-blue-100 text-blue-700">Shared Report</Badge>
            <Badge variant="outline">Uses {sharedLink.uses || 0}</Badge>
          </div>
        </div>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle>{proposal?.title || 'Shared Proposal'}</CardTitle>
            <CardDescription>
              {proposal?.template_name || 'Template'} • Status: {proposal?.status || sharedLink.status}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-slate-600">{proposal?.summary || 'No summary provided.'}</p>
            <p className="text-xs text-slate-500 break-all">Token: {sharedLink.token}</p>
            {latestEvaluation ? (
              <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-200">
                <p className="text-sm font-medium text-indigo-900">
                  Latest Evaluation: {latestEvaluation.score ?? '—'}
                </p>
                <p className="text-sm text-indigo-800">{latestEvaluation.summary || 'No summary'}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle>Submit Recipient Response</CardTitle>
            <CardDescription>
              Update your response values and optionally run a re-evaluation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label>Recipient Email</Label>
              <Input
                type="email"
                value={responderEmail}
                onChange={(event) => setResponderEmail(event.target.value)}
                placeholder="recipient@example.com"
              />
            </div>

            {questions.length === 0 ? (
              <p className="text-sm text-slate-500">
                No structured questions were found on this proposal. You can still submit a general response.
              </p>
            ) : (
              <div className="space-y-3">
                {questions.map((question) => (
                  <div key={question.question_id} className="space-y-1">
                    <Label>{question.question_id}</Label>
                    <Textarea
                      rows={2}
                      value={questionValues[question.question_id] || ''}
                      onChange={(event) =>
                        setQuestionValues((prev) => ({
                          ...prev,
                          [question.question_id]: event.target.value,
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
            )}

            {submitMutation.error ? (
              <Alert className="bg-red-50 border-red-200">
                <AlertTriangle className="h-4 w-4 text-red-700" />
                <AlertDescription className="text-red-800">{submitMutation.error.message}</AlertDescription>
              </Alert>
            ) : null}

            {submitMutation.data ? (
              <Alert className="bg-green-50 border-green-200">
                <CheckCircle2 className="h-4 w-4 text-green-700" />
                <AlertDescription className="text-green-800">
                  Responses saved ({submitMutation.data.savedResponses} fields).
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="flex flex-wrap gap-3">
              <Button onClick={() => submitMutation.mutate(false)} disabled={submitMutation.isPending}>
                <Send className="w-4 h-4 mr-2" />
                {submitMutation.isPending ? 'Submitting...' : 'Submit Responses'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => submitMutation.mutate(true)}
                disabled={submitMutation.isPending}
              >
                <Sparkles className="w-4 h-4 mr-2" />
                Re-evaluate
              </Button>
              <Button variant="outline" onClick={() => refetch()}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh
              </Button>
            </div>
          </CardContent>
        </Card>

        {comparison ? (
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-indigo-600" />
                Document Comparison Workspace
              </CardTitle>
              <CardDescription>{comparison.title}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-slate-600">
                Continue recipient edit flow for the linked comparison draft.
              </p>
              <div className="flex gap-3 flex-wrap">
                {proposal?.id ? (
                  <Link
                    to={createPageUrl(
                      `proposals/${encodeURIComponent(proposal.id)}/recipient-edit?sharedToken=${encodeURIComponent(token)}`,
                    )}
                  >
                    <Button variant="outline">
                      <PenSquare className="w-4 h-4 mr-2" />
                      Recipient Edit Step 2
                    </Button>
                  </Link>
                ) : null}
                <Link to={createPageUrl(`DocumentComparisonDetail?id=${encodeURIComponent(comparison.id)}`)}>
                  <Button variant="outline">Open Comparison Detail</Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
