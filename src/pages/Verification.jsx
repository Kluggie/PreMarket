import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { accountClient } from '@/api/accountClient';
import { verificationClient } from '@/api/verificationClient';
import { useAuth } from '@/lib/AuthContext';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  ArrowLeft,
  CheckCircle2,
  Mail,
  Shield,
  AlertCircle,
} from 'lucide-react';

function mapVerificationBanner(search) {
  const params = new URLSearchParams(search || '');
  const verified = String(params.get('verified') || '').trim().toLowerCase();
  const code = String(params.get('code') || '').trim().toLowerCase();

  if (verified === 'success') {
    return {
      tone: 'success',
      message: 'Email verification completed successfully.',
    };
  }

  if (verified !== 'error') {
    return null;
  }

  if (code === 'token_used') {
    return {
      tone: 'error',
      message: 'This verification link has already been used.',
    };
  }

  if (code === 'token_expired') {
    return {
      tone: 'error',
      message: 'This verification link has expired. Please request a new email.',
    };
  }

  if (code === 'token_invalid' || code === 'token_missing') {
    return {
      tone: 'error',
      message: 'This verification link is invalid. Please request a new email.',
    };
  }

  return {
    tone: 'error',
    message: 'Verification could not be completed. Please request a new email.',
  };
}

export default function Verification() {
  const { user, isLoadingAuth, navigateToLogin } = useAuth();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [emailSent, setEmailSent] = useState(false);
  const banner = useMemo(() => mapVerificationBanner(location.search), [location.search]);

  useEffect(() => {
    if (!isLoadingAuth && !user) {
      navigateToLogin(`/verification${location.search || ''}`);
    }
  }, [isLoadingAuth, location.search, navigateToLogin, user]);

  const profileQuery = useQuery({
    queryKey: ['userProfile', user?.email],
    queryFn: () => accountClient.getProfile(),
    enabled: Boolean(user?.email),
  });

  const sendEmailMutation = useMutation({
    mutationFn: () => verificationClient.sendEmail(),
    onSuccess: async (payload) => {
      if (payload.alreadyVerified) {
        return;
      }

      setEmailSent(true);
      await queryClient.invalidateQueries({ queryKey: ['userProfile'] });
      await queryClient.invalidateQueries({ queryKey: ['verificationStatus'] });
    },
  });

  if (isLoadingAuth || profileQuery.isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-4xl mx-auto px-4">
          <div className="animate-pulse space-y-6">
            <div className="h-8 bg-slate-200 rounded w-52" />
            <div className="h-52 bg-slate-100 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const profile = profileQuery.data || null;
  const isVerified = Boolean(profile?.email_verified || profile?.verification_status === 'verified');
  const isPending = !isVerified && profile?.verification_status === 'pending';

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <Link
              to={createPageUrl('Profile')}
              className="inline-flex items-center text-slate-600 hover:text-slate-900 mb-2"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Profile
            </Link>
            <h1 className="text-2xl font-bold text-slate-900">Account Verification</h1>
            <p className="text-slate-500 mt-1">Verify your email to build trust on PreMarket.</p>
          </div>
          <Badge className={isVerified ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-700'}>
            {isVerified ? 'Verified' : isPending ? 'Pending' : 'Unverified'}
          </Badge>
        </div>

        {banner ? (
          <Card className="border-0 shadow-sm mb-6">
            <CardContent className="p-5">
              <div
                className={`flex items-start gap-2 ${
                  banner.tone === 'success' ? 'text-green-700' : 'text-red-700'
                }`}
              >
                {banner.tone === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 mt-0.5" />
                )}
                <p className="text-sm">{banner.message}</p>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card className={`border-0 shadow-sm ${isVerified ? 'bg-green-50/50' : ''}`}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="w-5 h-5 text-slate-500" />
              Email Verification
            </CardTitle>
            <CardDescription>
              Confirm your account email address to unlock verified status.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Shield className="w-4 h-4 text-slate-500" />
              Verification email will be sent to <span className="font-medium">{user.email}</span>
            </div>

            {isVerified ? (
              <div className="flex items-center gap-2 text-green-700 text-sm font-medium">
                <CheckCircle2 className="w-4 h-4" />
                Your email is verified.
              </div>
            ) : (
              <Button
                onClick={() => sendEmailMutation.mutate()}
                disabled={sendEmailMutation.isPending}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {sendEmailMutation.isPending ? 'Sending...' : 'Send Verification Email'}
              </Button>
            )}

            {emailSent && !isVerified ? (
              <p className="text-sm text-blue-700">
                Verification email sent. Check your inbox and click the secure link to complete verification.
              </p>
            ) : null}

            {sendEmailMutation.isError ? (
              <p className="text-sm text-red-600">
                {sendEmailMutation.error?.message || 'Unable to send verification email right now.'}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
