import React, { useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createPageUrl } from '@/utils';
import { proposalsClient } from '@/api/proposalsClient';
import { documentComparisonsClient } from '@/api/documentComparisonsClient';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, ArrowLeft, Loader2 } from 'lucide-react';
import ComparisonWorkflowShell from '@/components/document-comparison/ComparisonWorkflowShell';
import Step2EditSources from '@/components/document-comparison/Step2EditSources';
import DocumentComparisonEditorErrorBoundary from '@/components/document-comparison/DocumentComparisonEditorErrorBoundary';
import {
  VISIBILITY_CONFIDENTIAL,
  VISIBILITY_SHARED,
} from '@/pages/document-comparison/documentsModel';

function useSharedToken() {
  const location = useLocation();
  return useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    return params.get('sharedToken') || params.get('token') || '';
  }, [location.search]);
}

export default function RecipientEditStep2() {
  const navigate = useNavigate();
  const { proposalId } = useParams();
  const sharedToken = useSharedToken();

  const [title, setTitle] = useState('');
  const [docBText, setDocBText] = useState('');
  const [docBHtml, setDocBHtml] = useState('');
  const [docBJson, setDocBJson] = useState(null);
  const [activeDocId, setActiveDocId] = useState('doc-b');

  const proposalQuery = useQuery({
    queryKey: ['recipient-edit-proposal', proposalId],
    enabled: Boolean(proposalId),
    queryFn: () => proposalsClient.getById(proposalId),
  });

  const comparisonId = proposalQuery.data?.document_comparison_id || '';

  const comparisonQuery = useQuery({
    queryKey: ['recipient-edit-comparison', comparisonId],
    enabled: Boolean(comparisonId),
    queryFn: () => documentComparisonsClient.getById(comparisonId),
  });

  const comparison = comparisonQuery.data?.comparison || null;

  React.useEffect(() => {
    if (!comparison) return;
    setTitle(comparison.title || '');
    setDocBText(comparison.doc_b_text || '');
    setDocBHtml(comparison.doc_b_html || '');
    setDocBJson(comparison.doc_b_json || null);
  }, [comparison]);

  const documents = useMemo(() => {
    if (!comparison) return [];
    return [
      {
        id: 'doc-a',
        label: comparison.party_a_label || 'Document A',
        json: comparison.doc_a_json || null,
        html: comparison.doc_a_html || '',
        text: comparison.doc_a_text || '',
        source: comparison.doc_a_source || 'typed',
        visibility: VISIBILITY_CONFIDENTIAL,
      },
      {
        id: 'doc-b',
        label: comparison.party_b_label || 'Document B',
        json: docBJson,
        html: docBHtml,
        text: docBText,
        source: comparison.doc_b_source || 'typed',
        visibility: VISIBILITY_SHARED,
      },
    ];
  }, [comparison, docBJson, docBHtml, docBText]);

  const handleDocumentContentChange = React.useCallback((id, { json, html, text } = {}) => {
    if (id !== 'doc-b') return;
    if (json !== undefined) setDocBJson(json);
    if (html !== undefined) setDocBHtml(html);
    if (text !== undefined) setDocBText(text);
  }, []);

  const saveMutation = useMutation({
    mutationFn: () =>
      documentComparisonsClient.update(comparisonId, {
        title,
        doc_b_text: docBText,
        doc_b_html: docBHtml || '',
        ...(docBJson ? { doc_b_json: docBJson } : {}),
        draft_step: 2,
        status: 'draft',
      }),
    onSuccess: () => {
      comparisonQuery.refetch();
    },
  });

  const step3Url = sharedToken
    ? createPageUrl(
        `proposals/${encodeURIComponent(proposalId || '')}/recipient-edit/highlighting?sharedToken=${encodeURIComponent(sharedToken)}`,
      )
    : createPageUrl(`proposals/${encodeURIComponent(proposalId || '')}/recipient-edit/highlighting`);

  const backTarget = sharedToken
    ? createPageUrl(`SharedReport?token=${encodeURIComponent(sharedToken)}`)
    : createPageUrl('Opportunities');

  const backLabel = sharedToken ? 'Back to Shared Report' : 'Back to Opportunities';

  const backSlot = (
    <button
      type="button"
      onClick={() => navigate(backTarget)}
      className="inline-flex items-center text-slate-600 hover:text-slate-900"
    >
      <ArrowLeft className="w-4 h-4 mr-2" />
      {backLabel}
    </button>
  );

  if (proposalQuery.isLoading || comparisonQuery.isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 py-6">
        <ComparisonWorkflowShell title="Document Comparison" step={2} totalSteps={4} progress={50} backSlot={backSlot}>
          <Card>
            <CardContent className="py-16 text-center">
              <Loader2 className="w-8 h-8 text-blue-600 mx-auto mb-4 animate-spin" />
              <p className="text-slate-700">Loading recipient draft...</p>
            </CardContent>
          </Card>
        </ComparisonWorkflowShell>
      </div>
    );
  }

  if (proposalQuery.error || comparisonQuery.error || !proposalQuery.data || !comparison) {
    return (
      <div className="min-h-screen bg-slate-50 py-6">
        <ComparisonWorkflowShell title="Document Comparison" step={2} totalSteps={4} progress={50} backSlot={backSlot}>
          <Alert className="bg-red-50 border-red-200">
            <AlertTriangle className="h-4 w-4 text-red-700" />
            <AlertDescription className="text-red-800">
              {proposalQuery.error?.message ||
                comparisonQuery.error?.message ||
                'Unable to load recipient draft.'}
            </AlertDescription>
          </Alert>
        </ComparisonWorkflowShell>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-6">
      <ComparisonWorkflowShell
        title="Document Comparison"
        subtitle={title || 'Recipient Draft'}
        step={2}
        totalSteps={4}
        progress={50}
        backSlot={backSlot}
        saveStatusLabel={saveMutation.isPending ? 'Saving\u2026' : saveMutation.isSuccess ? 'Saved' : undefined}
      >
        <DocumentComparisonEditorErrorBoundary
          onRetry={() => {}}
          onBackToStep1={() => navigate(backTarget)}
        >
          <Step2EditSources
            documents={documents}
            activeDocId={activeDocId}
            onSelectDoc={setActiveDocId}
            onDocumentContentChange={handleDocumentContentChange}
            readOnlyDocIds={['doc-a']}
            limits={{ perDocumentCharacterLimit: 300000, warningCharacterThreshold: 255000 }}
            saveDraftPending={saveMutation.isPending}
            exceedsAnySizeLimit={false}
            onSaveDraft={() => saveMutation.mutate()}
            onBack={() => navigate(backTarget)}
            onContinue={async () => {
              await saveMutation.mutateAsync();
              navigate(step3Url);
            }}
            continueLabel="Continue to Highlighting"
          />
        </DocumentComparisonEditorErrorBoundary>
      </ComparisonWorkflowShell>
    </div>
  );
}
