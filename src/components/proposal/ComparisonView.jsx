import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, AlertCircle, HelpCircle, Minus } from 'lucide-react';

export default function ComparisonView({ template, proposerResponses, recipientResponses }) {
  // Group by comparable_key
  const comparableQuestions = template.questions?.filter(q => q.comparable_key) || [];
  const grouped = comparableQuestions.reduce((acc, question) => {
    const key = question.comparable_key;
    if (!acc[key]) acc[key] = { questions: [], proposer: null, recipient: null };
    acc[key].questions.push(question);
    return acc;
  }, {});

  // Match responses
  Object.keys(grouped).forEach(key => {
    const questions = grouped[key].questions;
    questions.forEach(q => {
      const proposerResp = proposerResponses.find(r => r.question_id === q.id && r.role === 'proposer');
      const recipientResp = recipientResponses.find(r => r.question_id === q.id && r.role === 'recipient');
      if (proposerResp) grouped[key].proposer = proposerResp;
      if (recipientResp) grouped[key].recipient = recipientResp;
    });
  });

  const getMatchStatus = (proposer, recipient) => {
    if (!proposer || !recipient) return { status: 'unknown', icon: HelpCircle, color: 'text-slate-400', label: 'Unknown' };
    
    // Simple heuristic for now
    if (proposer.value === recipient.value) {
      return { status: 'match', icon: CheckCircle2, color: 'text-green-600', label: 'Match' };
    }
    
    // For ranges, check overlap
    if (proposer.value_type === 'range' && recipient.value_type === 'range') {
      const overlap = proposer.range_max >= recipient.range_min && proposer.range_min <= recipient.range_max;
      if (overlap) {
        return { status: 'partial', icon: Minus, color: 'text-amber-600', label: 'Partial' };
      }
      return { status: 'no_match', icon: AlertCircle, color: 'text-red-600', label: 'No Match' };
    }
    
    return { status: 'partial', icon: Minus, color: 'text-amber-600', label: 'Partial' };
  };

  return (
    <div className="space-y-6">
      {Object.entries(grouped).map(([key, data]) => {
        const matchInfo = getMatchStatus(data.proposer, data.recipient);
        const Icon = matchInfo.icon;
        
        return (
          <Card key={key} className="border-0 shadow-sm">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg capitalize">{key.replace(/_/g, ' ')}</CardTitle>
                <Badge className={`${matchInfo.color} bg-opacity-10`}>
                  <Icon className={`w-3 h-3 mr-1 ${matchInfo.color}`} />
                  {matchInfo.label}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-blue-50 rounded-xl">
                  <p className="text-xs text-blue-600 font-medium mb-2">{template.party_a_label} (Proposer)</p>
                  {data.proposer ? (
                    <p className="font-medium text-slate-900">
                      {data.proposer.value_type === 'range' 
                        ? `${data.proposer.range_min} - ${data.proposer.range_max}`
                        : data.proposer.value}
                    </p>
                  ) : (
                    <p className="text-slate-500 italic">Not provided</p>
                  )}
                </div>
                <div className="p-4 bg-indigo-50 rounded-xl">
                  <p className="text-xs text-indigo-600 font-medium mb-2">{template.party_b_label} (Recipient)</p>
                  {data.recipient ? (
                    <p className="font-medium text-slate-900">
                      {data.recipient.value_type === 'range' 
                        ? `${data.recipient.range_min} - ${data.recipient.range_max}`
                        : data.recipient.value}
                    </p>
                  ) : (
                    <p className="text-slate-500 italic">Not provided</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
      
      {Object.keys(grouped).length === 0 && (
        <Card className="border-0 shadow-sm">
          <CardContent className="py-12 text-center">
            <HelpCircle className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-500">No comparable fields in this template.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}