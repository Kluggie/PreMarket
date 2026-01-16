import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Mail, Shield, CheckCircle2 } from 'lucide-react';

export default function GuestEmailCapture({ onEmailSubmit, isSubmitting }) {
  const [email, setEmail] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    onEmailSubmit(email);
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="w-5 h-5 text-blue-600" />
          Almost Done!
        </CardTitle>
        <CardDescription>
          Enter your email to receive a magic link for accessing and editing your proposal.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="guest-email">Email Address *</Label>
            <Input
              id="guest-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="text-lg"
            />
          </div>

          <div className="p-4 bg-blue-50 rounded-xl border border-blue-100 space-y-2">
            <div className="flex items-start gap-2 text-sm text-blue-700">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>View your evaluation report</span>
            </div>
            <div className="flex items-start gap-2 text-sm text-blue-700">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>Edit proposal later via magic link</span>
            </div>
            <div className="flex items-start gap-2 text-sm text-blue-700">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>Share proposal with recipient</span>
            </div>
          </div>

          <Button 
            type="submit" 
            disabled={isSubmitting || !email}
            className="w-full bg-blue-600 hover:bg-blue-700"
          >
            {isSubmitting ? 'Creating Proposal...' : 'Create Proposal'}
          </Button>

          <p className="text-xs text-slate-500 text-center">
            <Shield className="w-3 h-3 inline mr-1" />
            We'll only use your email to send the magic link. No spam.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}