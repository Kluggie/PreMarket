import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { CheckCircle2, XCircle, HelpCircle, AlertCircle } from 'lucide-react';

export default function SimpleVerificationView({ proposal, responses, template, userParty }) {
  const [verificationStates, setVerificationStates] = useState({});
  const [comments, setComments] = useState({});
  const [evidenceUrls, setEvidenceUrls] = useState({});
  const queryClient = useQueryClient();

  const verifyMutation = useMutation({
    mutationFn: async ({ responseId, questionId, status }) => {
      return await base44.entities.VerificationItem.create({
        proposal_id: proposal.id,
        question_id: questionId,
        response_id: responseId,
        verified_by_user_id: userParty === 'a' ? proposal.party_a_user_id : proposal.party_b_user_id,
        verified_by_party: userParty,
        status: status,
        comment: comments[responseId] || null,
        evidence_url: evidenceUrls[responseId] || null
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['verifications', proposal.id]);
    }
  });

  const proposerResponses = responses.filter(r => r.role === 'proposer');

  // Group by section
  const grouped = proposerResponses.reduce((acc, resp) => {
    const question = template.questions?.find(q => q.id === resp.question_id);
    const section = question?.section_id || 'General';
    if (!acc[section]) acc[section] = [];
    acc[section].push({ response: resp, question });
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <Card className="border-0 shadow-sm border-l-4 border-l-blue-500">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-blue-900">Verification Instructions</p>
              <p className="text-sm text-blue-700 mt-1">
                Mark each field as Confirmed (accurate), Disputed (incorrect), or Unknown (cannot verify).
                Add optional comments or evidence links where helpful. This is lightweight acknowledgement, not deep investigation.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {Object.entries(grouped).map(([section, items]) => (
        <Card key={section} className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">{section}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {items.map(({ response, question }) => {
              const currentStatus = verificationStates[response.id];
              const showEvidenceField = question?.verification_mode === 'evidence_optional' || 
                                       question?.verification_mode === 'evidence_recommended';

              return (
                <div key={response.id} className="p-4 border border-slate-200 rounded-xl">
                  <div className="mb-3">
                    <Label className="font-medium text-slate-900">{question?.label}</Label>
                    <div className="mt-2 p-3 bg-slate-50 rounded-lg">
                      <p className="text-slate-700">
                        {response.value_type === 'range' 
                          ? `${response.range_min} - ${response.range_max}`
                          : response.value || 'Not provided'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mb-3">
                    <Button
                      size="sm"
                      variant={currentStatus === 'confirmed' ? 'default' : 'outline'}
                      className={currentStatus === 'confirmed' ? 'bg-green-600 hover:bg-green-700' : ''}
                      onClick={() => {
                        setVerificationStates(prev => ({ ...prev, [response.id]: 'confirmed' }));
                        verifyMutation.mutate({ responseId: response.id, questionId: question.id, status: 'confirmed' });
                      }}
                    >
                      <CheckCircle2 className="w-4 h-4 mr-1" />
                      Confirmed
                    </Button>
                    <Button
                      size="sm"
                      variant={currentStatus === 'disputed' ? 'default' : 'outline'}
                      className={currentStatus === 'disputed' ? 'bg-red-600 hover:bg-red-700' : ''}
                      onClick={() => {
                        setVerificationStates(prev => ({ ...prev, [response.id]: 'disputed' }));
                        verifyMutation.mutate({ responseId: response.id, questionId: question.id, status: 'disputed' });
                      }}
                    >
                      <XCircle className="w-4 h-4 mr-1" />
                      Disputed
                    </Button>
                    <Button
                      size="sm"
                      variant={currentStatus === 'unknown' ? 'default' : 'outline'}
                      onClick={() => {
                        setVerificationStates(prev => ({ ...prev, [response.id]: 'unknown' }));
                        verifyMutation.mutate({ responseId: response.id, questionId: question.id, status: 'unknown' });
                      }}
                    >
                      <HelpCircle className="w-4 h-4 mr-1" />
                      Unknown
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <div>
                      <Label className="text-xs text-slate-500">Comment (optional)</Label>
                      <Textarea
                        placeholder="Add any notes..."
                        value={comments[response.id] || ''}
                        onChange={(e) => setComments(prev => ({ ...prev, [response.id]: e.target.value }))}
                        className="mt-1 text-sm h-20"
                      />
                    </div>
                    {showEvidenceField && (
                      <div>
                        <Label className="text-xs text-slate-500">
                          Evidence Link ({question.verification_mode === 'evidence_recommended' ? 'recommended' : 'optional'})
                        </Label>
                        <Input
                          type="url"
                          placeholder="https://..."
                          value={evidenceUrls[response.id] || ''}
                          onChange={(e) => setEvidenceUrls(prev => ({ ...prev, [response.id]: e.target.value }))}
                          className="mt-1 text-sm"
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}