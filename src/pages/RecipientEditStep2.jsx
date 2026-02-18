import React, { useEffect, useMemo, useState } from 'react';
import { authClient } from '@/api/authClient';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { ArrowLeft, ArrowRight, FileText, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';

export default function RecipientEditStep2() {
  const navigate = useNavigate();
  const location = useLocation();
  const { proposalId } = useParams();

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [proposal, setProposal] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [title, setTitle] = useState('Recipient Draft');
  const [partyALabel, setPartyALabel] = useState('Document A');
  const [partyBLabel, setPartyBLabel] = useState('Document B');
  const [docAText, setDocAText] = useState('');
  const [docBText, setDocBText] = useState('');
  const [continuing, setContinuing] = useState(false);

  const sharedToken = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('sharedToken') || params.get('token');
  }, [location.search]);

  useEffect(() => {
    authClient.me().then((me) => setUser(me || null)).catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (!proposalId) {
      setLoadError('Missing draft proposal id');
      setLoading(false);
      return;
    }

    let cancelled = false;
    const loadDraft = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const proposalRows = await base44.entities.Proposal.filter({ id: proposalId }, '-created_date', 1);
        const draftProposal = proposalRows?.[0] || null;
        if (!draftProposal) {
          throw new Error('Draft proposal not found');
        }
        if (String(draftProposal?.proposal_type || '').toLowerCase() !== 'document_comparison') {
          throw new Error('Draft proposal is not a document comparison');
        }

        const comparisonId = draftProposal?.document_comparison_id || draftProposal?.documentComparisonId;
        if (!comparisonId) {
          throw new Error('Draft proposal is missing document comparison id');
        }

        const comparisonRows = await base44.entities.DocumentComparison.filter({ id: comparisonId }, '-created_date', 1);
        const draftComparison = comparisonRows?.[0] || null;
        if (!draftComparison) {
          throw new Error('Draft comparison not found');
        }

        if (cancelled) return;
        setProposal(draftProposal);
        setComparison(draftComparison);
        setTitle(draftProposal?.title || draftComparison?.title || 'Recipient Draft');
        setPartyALabel(draftComparison?.party_a_label || 'Document A');
        setPartyBLabel(draftComparison?.party_b_label || 'Document B');
        setDocAText(String(draftComparison?.doc_a_plaintext || ''));
        setDocBText(String(draftComparison?.doc_b_plaintext || ''));
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        setLoadError(message);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadDraft();
    return () => {
      cancelled = true;
    };
  }, [proposalId]);

  const handleSaveDraft = async () => {
    if (!proposal?.id || !comparison?.id) return;
    setSaving(true);
    try {
      const nowIso = new Date().toISOString();
      const safeTitle = String(title || '').trim() || 'Recipient Draft';
      await base44.entities.DocumentComparison.update(comparison.id, {
        title: safeTitle,
        doc_b_plaintext: docBText,
        status: 'draft',
        draft_step: 2,
        draft_updated_at: nowIso
      });

      await base44.entities.Proposal.update(proposal.id, {
        title: safeTitle,
        status: 'draft',
        draft_step: 2,
        draft_updated_at: nowIso,
        ...(user?.id ? { created_by_user_id: user.id } : {}),
        ...(user?.id ? { party_a_user_id: user.id } : {}),
        ...(user?.email ? { party_a_email: user.email } : {})
      });

      setProposal((prev) => (prev ? { ...prev, title: safeTitle } : prev));
      setComparison((prev) => (prev ? { ...prev, title: safeTitle } : prev));
      toast.success('Draft saved');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Failed to save draft: ${message}`);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const step3Url = sharedToken
    ? createPageUrl(`proposals/${encodeURIComponent(proposal?.id || proposalId || '')}/recipient-edit/highlighting?sharedToken=${encodeURIComponent(sharedToken)}`)
    : createPageUrl(`proposals/${encodeURIComponent(proposal?.id || proposalId || '')}/recipient-edit/highlighting`);

  const handleContinueToStep3 = async () => {
    if (!proposal?.id || !comparison?.id || continuing) return;
    setContinuing(true);
    try {
      const ok = await handleSaveDraft();
      if (!ok) return;
      navigate(step3Url);
    } finally {
      setContinuing(false);
    }
  };

  const backTarget = sharedToken
    ? createPageUrl(`SharedReport?token=${encodeURIComponent(sharedToken)}&mode=workspace`)
    : createPageUrl('Proposals');

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-[1400px] mx-auto px-12">
          <Card>
            <CardContent className="py-16 text-center">
              <Loader2 className="w-8 h-8 text-blue-600 mx-auto mb-4 animate-spin" />
              <p className="text-slate-700">Loading recipient draft...</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-[1400px] mx-auto px-12">
          <Card>
            <CardContent className="py-16 text-center">
              <p className="text-red-700 font-medium mb-2">Unable to open recipient edit draft</p>
              <p className="text-sm text-slate-600 mb-4">{loadError}</p>
              <Button variant="outline" onClick={() => navigate(backTarget)}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-6">
      <div className="max-w-[1400px] mx-auto px-12">
        <div className="mb-5">
          <Button variant="ghost" onClick={() => navigate(backTarget)} className="mb-2 px-0">
            <ArrowLeft className="w-4 h-4 mr-2" />
            {sharedToken ? 'Back to Shared Report' : 'Back to Proposals'}
          </Button>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Document Comparison</h1>
              <p className="text-slate-500 mt-1">{title}</p>
            </div>
            <Badge className="bg-slate-100 text-slate-700">Draft</Badge>
          </div>
        </div>

        <div className="mb-5">
          <div className="flex items-center justify-between text-sm mb-3">
            <span className="font-semibold text-blue-600">Step 2 of 4</span>
            <span className="text-slate-500">50% complete</span>
          </div>
          <Progress value={50} className="h-3" />
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Step 2: Content Input</CardTitle>
            <CardDescription>
              Document A is read-only. Update only Document B and save your draft.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-6">
              <label className="block text-sm font-semibold text-slate-600 mb-2">Draft Title</label>
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Enter draft title"
                className="max-w-2xl"
              />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-stretch">
              <div className="flex flex-col h-full space-y-3">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-slate-400" />
                  <h3 className="text-sm font-semibold text-slate-600">{partyALabel}</h3>
                  <Badge variant="outline">Read-only</Badge>
                </div>
                <Textarea
                  value={docAText}
                  readOnly
                  disabled
                  className="min-h-[540px] w-full bg-slate-100 border border-slate-200 rounded-md resize-none text-[15px] leading-relaxed text-slate-700 px-8 py-8"
                />
              </div>

              <div className="flex flex-col h-full space-y-3">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-slate-400" />
                  <h3 className="text-sm font-semibold text-slate-600">{partyBLabel}</h3>
                  <Badge className="bg-blue-100 text-blue-700">Editable</Badge>
                </div>
                <Textarea
                  value={docBText}
                  onChange={(event) => setDocBText(event.target.value)}
                  placeholder="Update your document content..."
                  className="min-h-[540px] w-full bg-white border border-gray-200 rounded-md shadow-sm resize-none text-[15px] leading-relaxed text-gray-800 px-8 py-8"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={handleSaveDraft} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Save Draft
          </Button>
          <Button
            onClick={handleContinueToStep3}
            disabled={continuing || saving || !proposal?.id || !comparison?.id}
          >
            {continuing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Continue to Highlighting
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </div>
    </div>
  );
}
