import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, XCircle, Shield, FileText, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

export default function SharedReport() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [shareLink, setShareLink] = useState(null);

  const params = new URLSearchParams(window.location.search);
  const shareLinkId = window.location.pathname.split('/shared/')[1];
  const token = params.get('token');

  useEffect(() => {
    if (!shareLinkId || !token) {
      setError('Invalid share link');
      setLoading(false);
      return;
    }

    loadShareLink();
  }, [shareLinkId, token]);

  const loadShareLink = async () => {
    try {
      setLoading(true);
      const links = await base44.asServiceRole.entities.ShareLink.filter({ id: shareLinkId });
      
      if (links.length === 0) {
        setError('Share link not found');
        setLoading(false);
        return;
      }

      const link = links[0];

      // Validate token
      if (link.token !== token) {
        setError('Invalid access token');
        setLoading(false);
        return;
      }

      // Check expiration
      if (new Date(link.expires_at) < new Date()) {
        setError('This share link has expired');
        setLoading(false);
        return;
      }

      // Check max uses
      if (link.uses >= link.max_uses) {
        setError('This share link has reached its maximum number of uses');
        setLoading(false);
        return;
      }

      // Check status
      if (link.status !== 'active') {
        setError('This share link is no longer active');
        setLoading(false);
        return;
      }

      // Update usage count
      await base44.asServiceRole.entities.ShareLink.update(link.id, {
        uses: (link.uses || 0) + 1,
        last_used_at: new Date().toISOString()
      });

      setShareLink(link);

      // Redirect to appropriate page
      if (link.document_comparison_id) {
        navigate(createPageUrl(`DocumentComparisonDetail?id=${link.document_comparison_id}`));
      } else if (link.proposal_id) {
        navigate(createPageUrl(`ProposalDetail?id=${link.proposal_id}`));
      } else if (link.evaluation_item_id) {
        navigate(createPageUrl(`ReportViewer?evalItemId=${link.evaluation_item_id}`));
      } else {
        setError('Unable to determine report location');
      }

      setLoading(false);
    } catch (err) {
      console.error('Load share link error:', err);
      setError(err.message || 'Failed to load share link');
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Card className="border-0 shadow-sm w-full max-w-md">
          <CardContent className="py-16 text-center">
            <Loader2 className="w-12 h-12 text-blue-500 mx-auto mb-4 animate-spin" />
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Loading report...</h3>
            <p className="text-slate-500">Please wait while we verify your access.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Card className="border-0 shadow-sm w-full max-w-md">
          <CardContent className="py-16 text-center">
            <XCircle className="w-12 h-12 text-red-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Access Denied</h3>
            <p className="text-slate-500 mb-6">{error}</p>
            <Button onClick={() => navigate(createPageUrl('Dashboard'))}>
              Go to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <Card className="border-0 shadow-sm w-full max-w-md">
        <CardContent className="py-16 text-center">
          <FileText className="w-12 h-12 text-blue-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 mb-2">Redirecting...</h3>
          <p className="text-slate-500">Taking you to the report.</p>
        </CardContent>
      </Card>
    </div>
  );
}