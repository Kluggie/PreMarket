import React from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { createPageUrl } from '@/utils';

export default function Phase2Placeholder({ title, description, showDashboardLink = true }) {
  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle>{title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-600">
              {description || 'This page is temporarily disabled during the Phase 2 API migration.'}
            </p>
            {showDashboardLink && (
              <Link to={createPageUrl('Dashboard')}>
                <Button variant="outline">Return to Dashboard</Button>
              </Link>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
