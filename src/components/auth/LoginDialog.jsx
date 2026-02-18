import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import GoogleSignInButton from '@/components/auth/GoogleSignInButton';

export default function LoginDialog({
  open,
  onOpenChange,
  returnTo,
  onAuthenticated,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sign in to PreMarket</DialogTitle>
          <DialogDescription>
            Continue with Google to access your dashboard securely.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <GoogleSignInButton
            returnTo={returnTo}
            width={340}
            onSuccess={onAuthenticated}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
