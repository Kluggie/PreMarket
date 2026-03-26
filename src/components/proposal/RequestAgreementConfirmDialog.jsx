import React from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export function RequestAgreementConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  isPending = false,
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Request agreement?</AlertDialogTitle>
          <AlertDialogDescription>
            This will notify the other party immediately by email and in-app notification. This
            action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={isPending}
            onClick={() => {
              if (typeof onConfirm === 'function') {
                onConfirm();
              }
            }}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {isPending ? 'Sending...' : 'Request Agreement'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default RequestAgreementConfirmDialog;
