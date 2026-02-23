import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  LoaderCircle,
} from 'lucide-react';

function useVerificationToken() {
  const location = useLocation();

  return useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    return String(params.get('token') || '').trim();
  }, [location.search]);
}

export default function Verification() {
  const { user, isLoadingAuth, navigateToLogin } = useAuth();
  const queryClient = useQueryClient();
  const token = useVerificationToken();
  const hasAttemptedToken = useRef(false);
  const [emailSent, setEmailSent] = useState(false);

  useEffect(() => {
    if (!isLoadingAuth && !user) {
      navigateToLogin('/verification');
    }
  }, [isLoadingAuth, navigateToLogin, user]);

  const profileQuery = useQuery({
    queryKey: ['userProfile', user?.email],
    queryFn: () => accountClient.getProfile(),
    enabled: Boolean(user?.email),
  });

  const verifyTokenMutation = useMutation({
    mutationFn: (verificationToken) => verificationClient.confirm(verificationToken),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['userProfile'] });
      await queryClient.invalidateQueries({ queryKey: ['verificationStatus'] });
    },
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

  useEffect(() => {
    if (!token || hasAttemptedToken.current) {
      return;
    }

    hasAttemptedToken.current = true;
    verifyTokenMutation.mutate(token);
  }, [token, verifyTokenMutation]);

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

        {token ? (
          <Card className="border-0 shadow-sm mb-6">
            <CardContent className="p-5">
              {verifyTokenMutation.isPending ? (
                <div className="flex items-center gap-2 text-slate-700">
                  <LoaderCircle className="w-4 h-4 animate-spin" />
                  Verifying your email link...
                </div>
              ) : null}

              {verifyTokenMutation.isSuccess ? (
                <div className="flex items-center gap-2 text-green-700">
                  <CheckCircle2 className="w-4 h-4" />
                  Email verification completed successfully.
                </div>
              ) : null}

              {verifyTokenMutation.isError ? (
                <div className="flex items-start gap-2 text-red-700">
                  <AlertCircle className="w-4 h-4 mt-0.5" />
                  <p className="text-sm">
                    {verifyTokenMutation.error?.message || 'This verification link is invalid or expired.'}
                  </p>
                </div>
              ) : null}
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
