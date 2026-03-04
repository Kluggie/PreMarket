import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import GoogleSignInButton from '@/components/auth/GoogleSignInButton';
import { authClient } from '@/api/authClient';

const LOGIN_DIALOG_GOOGLE_SIGNIN_WIDTH = 306;

export default function LoginDialog({
  open,
  onOpenChange,
  returnTo,
  onAuthenticated,
}) {
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaRedirectTo, setMfaRedirectTo] = useState('');
  const [mfaError, setMfaError] = useState('');
  const [submittingMfa, setSubmittingMfa] = useState(false);

  useEffect(() => {
    if (!open) {
      setMfaRequired(false);
      setMfaCode('');
      setMfaRedirectTo('');
      setMfaError('');
      setSubmittingMfa(false);
    }
  }, [open]);

  const handleGoogleSuccess = async (result) => {
    if (result?.mfa_required || result?.mfaRequired) {
      setMfaRequired(true);
      setMfaCode('');
      setMfaError('');
      setMfaRedirectTo(result?.redirectTo || returnTo || '/');
      return;
    }

    onAuthenticated?.(result);
  };

  const handleMfaSubmit = async () => {
    if (!mfaCode.trim()) {
      setMfaError('Enter a 6-digit code or backup code.');
      return;
    }

    setSubmittingMfa(true);
    setMfaError('');
    try {
      const result = await authClient.completeMfaChallenge(mfaCode);
      onAuthenticated?.({
        ...result,
        redirectTo: mfaRedirectTo || result?.redirectTo || returnTo || '/',
      });
    } catch (error) {
      setMfaError(error?.message || 'Unable to verify authentication code.');
    } finally {
      setSubmittingMfa(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mfaRequired ? 'Two-Factor Authentication' : 'Sign in to PreMarket'}</DialogTitle>
          <DialogDescription>
            {mfaRequired
              ? 'Enter a 6-digit authenticator code or a backup code to complete sign-in.'
              : 'Continue with Google to access your dashboard securely.'}
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          {mfaRequired ? (
            <div className="space-y-3">
              <Input
                value={mfaCode}
                onChange={(event) => setMfaCode(event.target.value)}
                placeholder="123456 or backup code"
                autoComplete="one-time-code"
              />
              {mfaError ? <p className="text-xs text-red-600">{mfaError}</p> : null}
              <div className="flex gap-2">
                <Button onClick={handleMfaSubmit} disabled={submittingMfa} className="flex-1">
                  {submittingMfa ? 'Verifying...' : 'Verify'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setMfaRequired(false);
                    setMfaCode('');
                    setMfaError('');
                  }}
                  disabled={submittingMfa}
                >
                  Back
                </Button>
              </div>
            </div>
          ) : (
            <GoogleSignInButton
              returnTo={returnTo}
              width={LOGIN_DIALOG_GOOGLE_SIGNIN_WIDTH}
              onSuccess={handleGoogleSuccess}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
