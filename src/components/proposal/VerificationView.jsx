import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle, HelpCircle, AlertCircle } from 'lucide-react';
import { verificationItemsClient } from '@/api/verificationItemsClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export default function VerificationView({ proposal, responses, userParty }) {
  const [verificationStates, setVerificationStates] = useState({});
  const [notes, setNotes] = useState({});
  const queryClient = useQueryClient();

  const verifyMutation = useMutation({
    mutationFn: async ({ responseId, status, note }) => {
      return verificationItemsClient.create({
        proposal_id: proposal.id,
        question_id: responseId,
        verified_by_user_id: userParty === 'a' ? proposal.party_a_user_id : proposal.party_b_user_id,
        verified_by_party: userParty,
        status,
        notes: note,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['verifications', proposal.id] });
    },
  });

  const handleVerification = (responseId, status) => {
    setVerificationStates((prev) => ({ ...prev, [responseId]: status }));
    verifyMutation.mutate({
      responseId,
      status,
      note: notes[responseId] || '',
    });
  };

  const groupedResponses = responses.reduce((acc, response) => {
    const section = response.section_id || 'General';
    if (!acc[section]) {
      acc[section] = [];
    }
    acc[section].push(response);
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
                Review each field and mark it as Confirmed, Disputed, or Unknown.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {Object.entries(groupedResponses).map(([section, sectionResponses]) => {
        return (
          <Card key={section} className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">{section}</CardTitle>
              <CardDescription>Review and verify the information in this section.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {sectionResponses.map((response) => {
                const currentStatus = verificationStates[response.id];
                const isVerifying = verifyMutation.isPending;

                return (
                  <div key={response.id} className="p-4 border border-slate-200 rounded-xl">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <Label className="font-medium text-slate-900 capitalize">
                          {String(response.question_id || '').replace(/_/g, ' ')}
                        </Label>
                        <div className="mt-2 p-3 bg-slate-50 rounded-lg">
                          <p className="text-slate-700">
                            {response.value_type === 'range'
                              ? `Range: ${response.range_min} - ${response.range_max}`
                              : response.value || 'Not provided'}
                          </p>
                        </div>
                      </div>
                      <Badge variant="outline" className="text-xs ml-4">
                        {response.visibility}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-2 mt-4">
                      <span className="text-sm text-slate-600 mr-2">Verification:</span>
                      <Button
                        size="sm"
                        variant={currentStatus === 'confirmed' ? 'default' : 'outline'}
                        className={currentStatus === 'confirmed' ? 'bg-green-600 hover:bg-green-700' : ''}
                        onClick={() => handleVerification(response.id, 'confirmed')}
                        disabled={isVerifying}
                      >
                        <CheckCircle2 className="w-4 h-4 mr-1" />
                        Confirmed
                      </Button>
                      <Button
                        size="sm"
                        variant={currentStatus === 'disputed' ? 'default' : 'outline'}
                        className={currentStatus === 'disputed' ? 'bg-red-600 hover:bg-red-700' : ''}
                        onClick={() => handleVerification(response.id, 'disputed')}
                        disabled={isVerifying}
                      >
                        <XCircle className="w-4 h-4 mr-1" />
                        Disputed
                      </Button>
                      <Button
                        size="sm"
                        variant={currentStatus === 'pending' ? 'default' : 'outline'}
                        onClick={() => handleVerification(response.id, 'pending')}
                        disabled={isVerifying}
                      >
                        <HelpCircle className="w-4 h-4 mr-1" />
                        Unknown
                      </Button>
                    </div>

                    {currentStatus && (
                      <div className="mt-3">
                        <Label className="text-xs text-slate-500">Notes (optional)</Label>
                        <Textarea
                          placeholder="Add any comments about this field..."
                          value={notes[response.id] || ''}
                          onChange={(event) => setNotes((prev) => ({ ...prev, [response.id]: event.target.value }))}
                          className="mt-1 text-sm h-20"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
