import React from 'react';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export function StarterUpgradeModal({ open, onClose }) {
  const navigate = useNavigate();

  function handleViewPlans() {
    onClose();
    navigate(createPageUrl('Pricing'));
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>You've used all your opportunities this month</DialogTitle>
          <DialogDescription>
            You've already used all 5 opportunities included in Starter this month. Upgrade to continue evaluating deals.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-slate-500">
          Unlock more opportunities, deeper analysis, and advanced features.
        </p>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose}>
            Maybe later
          </Button>
          <Button className="bg-blue-600 hover:bg-blue-700" onClick={handleViewPlans}>
            View plans
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
