import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { 
  CheckCircle2, Circle, Mail, Building2, FileText, 
  Upload, AlertCircle, Shield, ArrowRight 
} from 'lucide-react';

export default function Verification() {
  const [user, setUser] = useState(null);
  const [domainInput, setDomainInput] = useState('');
  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setUser);
  }, []);

  const { data: profile } = useQuery({
    queryKey: ['userProfile', user?.email],
    queryFn: async () => {
      const profiles = await base44.entities.UserProfile.filter({ user_email: user?.email });
      return profiles[0] || null;
    },
    enabled: !!user?.email
  });

  const sendVerificationEmailMutation = useMutation({
    mutationFn: async () => {
      // In a real implementation, this would trigger a verification email
      // For now, we'll just mark as pending
      if (profile) {
        await base44.entities.UserProfile.update(profile.id, {
          verification_status: 'pending'
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['userProfile']);
    }
  });

  const uploadDocumentMutation = useMutation({
    mutationFn: async (file) => {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      if (profile) {
        await base44.entities.UserProfile.update(profile.id, {
          document_verified: true
        });
      }
      return file_url;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['userProfile']);
    }
  });

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadDocumentMutation.mutate(file);
    }
  };

  const steps = [
    {
      id: 'email',
      title: 'Email Verification',
      description: 'Verify your email address',
      icon: Mail,
      status: profile?.email_verified || user?.email ? 'completed' : 'pending',
      action: !profile?.email_verified && (
        <Button 
          onClick={() => sendVerificationEmailMutation.mutate()}
          disabled={sendVerificationEmailMutation.isPending}
          size="sm"
        >
          {sendVerificationEmailMutation.isPending ? 'Sending...' : 'Send Verification Email'}
        </Button>
      )
    },
    {
      id: 'domain',
      title: 'Domain Verification',
      description: 'Verify your organization domain (optional)',
      icon: Building2,
      status: profile?.domain_verified ? 'completed' : 'optional',
      action: !profile?.domain_verified && (
        <div className="space-y-3">
          <Input 
            placeholder="example.com"
            value={domainInput}
            onChange={(e) => setDomainInput(e.target.value)}
          />
          <Button size="sm" variant="outline" disabled>
            Coming Soon
          </Button>
        </div>
      )
    },
    {
      id: 'document',
      title: 'Document Verification',
      description: 'Upload identity or business documents (optional)',
      icon: FileText,
      status: profile?.document_verified ? 'completed' : 'optional',
      action: !profile?.document_verified && (
        <div>
          <input
            type="file"
            id="doc-upload"
            className="hidden"
            onChange={handleFileUpload}
            accept=".pdf,.jpg,.jpeg,.png"
          />
          <label htmlFor="doc-upload">
            <Button 
              type="button"
              size="sm"
              variant="outline"
              onClick={() => document.getElementById('doc-upload')?.click()}
              disabled={uploadDocumentMutation.isPending}
            >
              <Upload className="w-4 h-4 mr-2" />
              {uploadDocumentMutation.isPending ? 'Uploading...' : 'Upload Document'}
            </Button>
          </label>
        </div>
      )
    }
  ];

  const completedSteps = steps.filter(s => s.status === 'completed').length;
  const totalSteps = steps.filter(s => s.status !== 'optional').length;
  const overallProgress = (completedSteps / steps.length) * 100;

  const getVerificationBadge = () => {
    if (completedSteps === steps.length) {
      return { label: 'Fully Verified', color: 'bg-green-100 text-green-700' };
    } else if (completedSteps >= 1) {
      return { label: 'Partially Verified', color: 'bg-amber-100 text-amber-700' };
    }
    return { label: 'Unverified', color: 'bg-slate-100 text-slate-700' };
  };

  const badge = getVerificationBadge();

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Account Verification</h1>
              <p className="text-slate-500 mt-1">Increase trust and credibility through verification.</p>
            </div>
            <Badge className={badge.color}>{badge.label}</Badge>
          </div>
        </div>

        {/* Progress Overview */}
        <Card className="border-0 shadow-sm mb-8">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm text-slate-500">Verification Progress</p>
                <p className="text-2xl font-bold text-slate-900">{completedSteps} of {steps.length} completed</p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-bold text-blue-600">{Math.round(overallProgress)}%</p>
              </div>
            </div>
            <Progress value={overallProgress} className="h-2" />
          </CardContent>
        </Card>

        {/* Verification Steps */}
        <div className="space-y-4">
          {steps.map((step, idx) => (
            <motion.div
              key={step.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
            >
              <Card className={`border-0 shadow-sm ${
                step.status === 'completed' ? 'bg-green-50/50' : ''
              }`}>
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                      step.status === 'completed' 
                        ? 'bg-green-100' 
                        : step.status === 'optional'
                        ? 'bg-slate-100'
                        : 'bg-blue-100'
                    }`}>
                      {step.status === 'completed' ? (
                        <CheckCircle2 className="w-6 h-6 text-green-600" />
                      ) : (
                        <step.icon className={`w-6 h-6 ${
                          step.status === 'optional' ? 'text-slate-400' : 'text-blue-600'
                        }`} />
                      )}
                    </div>
                    
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-slate-900">{step.title}</h3>
                        {step.status === 'optional' && (
                          <Badge variant="outline" className="text-xs">Optional</Badge>
                        )}
                      </div>
                      <p className="text-sm text-slate-600 mb-4">{step.description}</p>
                      
                      {step.status !== 'completed' && step.action}
                      
                      {step.status === 'completed' && (
                        <div className="flex items-center gap-2 text-green-600">
                          <CheckCircle2 className="w-4 h-4" />
                          <span className="text-sm font-medium">Verified</span>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        {/* Benefits */}
        <Card className="border-0 shadow-sm mt-8 bg-blue-50">
          <CardContent className="p-6">
            <h3 className="font-semibold text-blue-900 mb-4">Benefits of Verification</h3>
            <ul className="space-y-2 text-sm text-blue-700">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                Higher trust scores in AI evaluations
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                Increased likelihood of mutual reveals
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                Verified badge displayed on your profile
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                Access to premium features (future)
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}