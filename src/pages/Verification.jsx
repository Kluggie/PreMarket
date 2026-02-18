import React, { useState, useEffect } from 'react';
import { authClient } from '@/api/authClient';
import { Link } from 'react-router-dom';
import { createPageUrl } from '../utils';
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
  Upload, AlertCircle, Shield, ArrowRight, ArrowLeft 
} from 'lucide-react';

export default function Verification() {
  const [user, setUser] = useState(null);
  const [domainInput, setDomainInput] = useState('');
  const queryClient = useQueryClient();

  useEffect(() => {
    authClient.me().then(setUser);
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
      // Send verification email and mark as verified (simplified for demo)
      if (profile) {
        await base44.entities.UserProfile.update(profile.id, {
          email_verified: true,
          verification_status: 'verified'
        });
      } else {
        // Create profile if doesn't exist
        await base44.entities.UserProfile.create({
          user_id: user.id,
          user_email: user.email,
          email_verified: true,
          verification_status: 'verified'
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
      status: profile?.email_verified ? 'completed' : 'pending',
      action: !profile?.email_verified && (
        <Button 
          onClick={() => sendVerificationEmailMutation.mutate()}
          disabled={sendVerificationEmailMutation.isPending}
          size="sm"
        >
          {sendVerificationEmailMutation.isPending ? 'Verifying...' : 'Verify Email'}
        </Button>
      )
    }
  ];

  const completedSteps = steps.filter(s => s.status === 'completed').length;
  const totalSteps = steps.length;
  const overallProgress = (completedSteps / totalSteps) * 100;

  const getVerificationBadge = () => {
    if (profile?.email_verified) {
      return { label: 'Verified', color: 'bg-green-100 text-green-700' };
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
              <Link to={createPageUrl('Profile')} className="inline-flex items-center text-slate-600 hover:text-slate-900 mb-2">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Profile
              </Link>
              <h1 className="text-2xl font-bold text-slate-900">Account Verification</h1>
              <p className="text-slate-500 mt-1">Verify your email to increase trust and credibility.</p>
            </div>
            <Badge className={badge.color}>{badge.label}</Badge>
          </div>
        </div>



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
                      
                      {step.action}
                      
                      {step.status === 'completed' && (
                        <div className="flex items-center gap-2 text-green-600 mt-2">
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


      </div>
    </div>
  );
}