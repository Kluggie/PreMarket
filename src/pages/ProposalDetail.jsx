import React, { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createPageUrl } from '@/utils';
import { proposalsClient } from '@/api/proposalsClient';
import { sharedLinksClient } from '@/api/sharedLinksClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  ArrowLeft,
  Send,
  RefreshCw,
  Share2,
  Sparkles,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  BarChart3,
} from 'lucide-react';

const statusConfig = {
  draft: { color: 'bg-slate-100 text-slate-700', label: 'Draft' },
  sent: { color: 'bg-blue-100 text-blue-700', label: 'Sent' },
  received: { color: 'bg-amber-100 text-amber-700', label: 'Received' },
  under_verification: { color: 'bg-purple-100 text-purple-700', label: 'Under Review' },
  re_evaluated: { color: 'bg-indigo-100 text-indigo-700', label: 'Re-evaluated' },
  mutual_interest: { color: 'bg-green-100 text-green-700', label: 'Mutual Interest' },
  revealed: { color: 'bg-emerald-100 text-emerald-700', label: 'Revealed' },
  closed: { color: 'bg-slate-100 text-slate-600', label: 'Closed' },
  withdrawn: { color: 'bg-red-100 text-red-700', label: 'Withdrawn' },
};

function StatusBadge({ status }) {
  const config = statusConfig[String(status || '').toLowerCase()] || statusConfig.draft;
  return <Badge className={`${config.color} font-medium`}>{config.label}</Badge>;
}

function useProposalId() {
  const location = useLocation();
  return useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    return params.get('id') || '';
  }, [location.search]);
}

export default function ProposalDetail() {
  const proposalId = useProposalId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [recipientEmail, setRecipientEmail] = useState('');
  const [shareRecipientEmail, setShareRecipientEmail] = useState('');
  const [formState, setFormState] = useState({
    title: '',
    summary: '',
    status: 'draft',
  });

  const {
    data: detail,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['proposal-detail', proposalId],
    enabled: Boolean(proposalId),
    queryFn: () => proposalsClient.getDetail(proposalId),
  });

  const proposal = detail?.proposal || null;
  const responses = detail?.responses || [];
  const evaluations = detail?.evaluations || [];
  const sharedLinks = detail?.sharedLinks || [];

  React.useEffect(() => {
    if (!proposal) return;
    setFormState({
      title: proposal.title || '',
      summary: proposal.summary || '',
      status: proposal.status || 'draft',
    });
    setRecipientEmail(proposal.party_b_email || '');
    setShareRecipientEmail(proposal.party_b_email || '');
  }, [proposal]);

  const saveMutation = useMutation({
    mutationFn: () =>
      proposalsClient.update(proposalId, {
        title: formState.title,
        summary: formState.summary,
        status: formState.status,
        party_b_email: recipientEmail || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries(['proposal-detail', proposalId]);
      queryClient.invalidateQueries(['proposals-list']);
      refetch();
    },
  });

  const sendMutation = useMutation({
    mutationFn: () =>
      proposalsClient.send(proposalId, {
        recipientEmail: recipientEmail || shareRecipientEmail || null,
        createShareLink: true,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries(['proposal-detail', proposalId]);
      queryClient.invalidateQueries(['proposals-list']);
      refetch();
    },
  });

  const evaluateMutation = useMutation({
    mutationFn: () => proposalsClient.evaluate(proposalId, {}),
    onSuccess: () => {
      queryClient.invalidateQueries(['proposal-detail', proposalId]);
      queryClient.invalidateQueries(['proposals-list']);
      refetch();
    },
  });

  const shareMutation = useMutation({
    mutationFn: () =>
      sharedLinksClient.create({
        proposalId,
        recipientEmail: shareRecipientEmail || recipientEmail || null,
        maxUses: 50,
        mode: 'workspace',
        canView: true,
        canEdit: true,
        canReevaluate: true,
        canSendBack: true,
        reportMetadata: {
          createdFrom: 'proposal_detail',
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries(['proposal-detail', proposalId]);
      refetch();
    },
  });

  const latestShareLink = sharedLinks[0] || sendMutation.data?.sharedLink || shareMutation.data || null;

  if (!proposalId) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <Alert className="bg-amber-50 border-amber-200">
            <AlertTriangle className="h-4 w-4 text-amber-700" />
            <AlertDescription className="text-amber-800">Missing proposal id.</AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-sm text-slate-600">Loading proposal...</p>
        </div>
      </div>
    );
  }

  if (error || !proposal) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <Alert className="bg-red-50 border-red-200">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-800">
              {error?.message || 'Proposal not found'}
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <Button variant="ghost" onClick={() => navigate(createPageUrl('Proposals'))}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Proposals
          </Button>
          <div className="flex items-center gap-2">
            <StatusBadge status={proposal.status} />
            {proposal.proposal_type === 'document_comparison' ? (
              <Badge className="bg-indigo-100 text-indigo-700">Document Comparison</Badge>
            ) : null}
          </div>
        </div>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>{proposal.title || 'Untitled Proposal'}</span>
              <span className="text-sm text-slate-500 font-normal">
                Created {proposal.created_date ? new Date(proposal.created_date).toLocaleString() : ''}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Title</Label>
                <Input
                  value={formState.title}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, title: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Recipient Email</Label>
                <Input
                  type="email"
                  value={recipientEmail}
                  onChange={(event) => setRecipientEmail(event.target.value)}
                  placeholder="recipient@example.com"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Summary</Label>
              <Textarea
                rows={3}
                value={formState.summary}
                onChange={(event) =>
                  setFormState((prev) => ({ ...prev, summary: event.target.value }))
                }
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" onClick={() => refetch()} disabled={isLoading}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh
              </Button>
              <Button variant="outline" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                <FileText className="w-4 h-4 mr-2" />
                {saveMutation.isPending ? 'Saving...' : 'Save Draft'}
              </Button>
              <Button onClick={() => sendMutation.mutate()} disabled={sendMutation.isPending}>
                <Send className="w-4 h-4 mr-2" />
                {sendMutation.isPending ? 'Sending...' : 'Send Proposal'}
              </Button>
              <Button variant="secondary" onClick={() => evaluateMutation.mutate()} disabled={evaluateMutation.isPending}>
                <Sparkles className="w-4 h-4 mr-2" />
                {evaluateMutation.isPending ? 'Running...' : 'Run Evaluation'}
              </Button>
              {proposal.document_comparison_id ? (
                <Link to={createPageUrl(`DocumentComparisonDetail?id=${encodeURIComponent(proposal.document_comparison_id)}`)}>
                  <Button variant="outline">
                    <Eye className="w-4 h-4 mr-2" />
                    Open Comparison
                  </Button>
                </Link>
              ) : null}
            </div>

            {saveMutation.error ? (
              <Alert className="bg-red-50 border-red-200">
                <AlertTriangle className="h-4 w-4 text-red-600" />
                <AlertDescription className="text-red-800">{saveMutation.error.message}</AlertDescription>
              </Alert>
            ) : null}
            {sendMutation.error ? (
              <Alert className="bg-red-50 border-red-200">
                <AlertTriangle className="h-4 w-4 text-red-600" />
                <AlertDescription className="text-red-800">{sendMutation.error.message}</AlertDescription>
              </Alert>
            ) : null}
            {evaluateMutation.error ? (
              <Alert className="bg-red-50 border-red-200">
                <AlertTriangle className="h-4 w-4 text-red-600" />
                <AlertDescription className="text-red-800">{evaluateMutation.error.message}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>

        <Tabs defaultValue="responses" className="space-y-4">
          <TabsList className="bg-white border border-slate-200">
            <TabsTrigger value="responses">Responses ({responses.length})</TabsTrigger>
            <TabsTrigger value="evaluations">Evaluations ({evaluations.length})</TabsTrigger>
            <TabsTrigger value="sharing">Sharing ({sharedLinks.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="responses">
            <Card className="border-0 shadow-sm">
              <CardContent className="pt-6">
                {responses.length === 0 ? (
                  <p className="text-sm text-slate-500">No responses captured yet.</p>
                ) : (
                  <div className="space-y-3">
                    {responses.map((row) => (
                      <div key={row.id} className="p-3 rounded-lg border border-slate-200 bg-white">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-slate-900">{row.question_id}</p>
                          <Badge variant="outline" className="text-xs">
                            {row.entered_by_party === 'b' ? 'Party B' : 'Party A'}
                          </Badge>
                        </div>
                        <p className="text-sm text-slate-600 mt-1">
                          {row.value || (row.range_min || row.range_max ? `${row.range_min || ''} - ${row.range_max || ''}` : '—')}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="evaluations">
            <Card className="border-0 shadow-sm">
              <CardContent className="pt-6">
                {evaluations.length === 0 ? (
                  <p className="text-sm text-slate-500">No evaluations yet.</p>
                ) : (
                  <div className="space-y-3">
                    {evaluations.map((evaluation) => (
                      <div key={evaluation.id} className="p-4 rounded-lg border border-slate-200 bg-white">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <BarChart3 className="w-4 h-4 text-indigo-600" />
                            <p className="font-medium text-slate-900">
                              Score {typeof evaluation.score === 'number' ? evaluation.score : '—'}
                            </p>
                          </div>
                          <Badge className="bg-indigo-100 text-indigo-700">
                            {evaluation.status || 'completed'}
                          </Badge>
                        </div>
                        <p className="text-sm text-slate-600 mt-2">{evaluation.summary || 'No summary'}</p>
                        <p className="text-xs text-slate-400 mt-2">
                          {evaluation.created_date ? new Date(evaluation.created_date).toLocaleString() : ''}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="sharing">
            <Card className="border-0 shadow-sm">
              <CardContent className="pt-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Share with recipient email</Label>
                    <Input
                      type="email"
                      value={shareRecipientEmail}
                      onChange={(event) => setShareRecipientEmail(event.target.value)}
                      placeholder="recipient@example.com"
                    />
                  </div>
                  <div className="flex items-end">
                    <Button onClick={() => shareMutation.mutate()} disabled={shareMutation.isPending}>
                      <Share2 className="w-4 h-4 mr-2" />
                      {shareMutation.isPending ? 'Creating...' : 'Create Shared Link'}
                    </Button>
                  </div>
                </div>

                {shareMutation.error ? (
                  <Alert className="bg-red-50 border-red-200">
                    <AlertTriangle className="h-4 w-4 text-red-600" />
                    <AlertDescription className="text-red-800">{shareMutation.error.message}</AlertDescription>
                  </Alert>
                ) : null}

                {latestShareLink ? (
                  <div className="p-4 rounded-lg border border-slate-200 bg-slate-50">
                    <div className="flex items-center gap-2 text-slate-900 font-medium">
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                      Active shared link
                    </div>
                    <p className="text-xs text-slate-500 mt-2 break-all">
                      Token: {latestShareLink.token}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <Link to={createPageUrl(`SharedReport?token=${encodeURIComponent(latestShareLink.token)}`)}>
                        <Button variant="outline">
                          <Eye className="w-4 h-4 mr-2" />
                          Open Shared Report
                        </Button>
                      </Link>
                      <Badge className="bg-blue-100 text-blue-700 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Uses {latestShareLink.uses || 0}
                      </Badge>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No shared links yet.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
