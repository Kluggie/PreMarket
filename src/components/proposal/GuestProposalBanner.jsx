import React from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '../../utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { base44 } from '@/api/base44Client';
import { Sparkles, ArrowRight, User } from 'lucide-react';

export default function GuestProposalBanner({ onCreateAccount }) {
  return (
    <Card className="border-0 shadow-sm bg-gradient-to-r from-blue-600 to-indigo-600 text-white mb-6">
      <CardContent className="p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-semibold text-lg mb-1">You're using Guest Mode</h3>
              <p className="text-blue-100 text-sm">
                Create an account to track analytics, manage multiple proposals, and access your dashboard.
              </p>
            </div>
          </div>
          <Button 
            onClick={() => base44.auth.redirectToLogin(createPageUrl('Dashboard'))}
            className="bg-white text-blue-600 hover:bg-blue-50 whitespace-nowrap"
          >
            <User className="w-4 h-4 mr-2" />
            Create Account
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}