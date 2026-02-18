import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { legacyClient } from '@/api/legacyClient';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export default function DirectoryOrgDetail() {
  const { id } = useParams();

  const { data, isLoading, error } = useQuery({
    queryKey: ['publicDirectoryOrg', id],
    queryFn: async () => {
      const response = await legacyClient.functions.invoke('PublicDirectoryGetDetail', { kind: 'org', id });
      return response?.data;
    },
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-3xl mx-auto px-4">
          <div className="h-64 rounded-xl bg-slate-100 animate-pulse" />
        </div>
      </div>
    );
  }

  if (error || !data?.ok || !data?.item) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-3xl mx-auto px-4">
          <Card>
            <CardContent className="py-10 text-center space-y-3">
              <p className="text-slate-700">This organization is not available in the public directory.</p>
              <Link to="/directory">
                <Button variant="outline">Back to Directory</Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const org = data.item;

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-3xl mx-auto px-4 space-y-4">
        <Link to="/directory" className="inline-block">
          <Button variant="outline" size="sm">Back to Directory</Button>
        </Link>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-2xl">{org.displayName}</CardTitle>
              <Badge>Organization</Badge>
            </div>
            {org.pseudonym && <CardDescription>Pseudonym: {org.pseudonym}</CardDescription>}
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-2">
              {org.type && <Badge variant="secondary">{org.type}</Badge>}
              {org.industry && <Badge variant="secondary">{org.industry}</Badge>}
              {org.location && <Badge variant="secondary">{org.location}</Badge>}
            </div>
            {org.bio && <p className="text-slate-700 whitespace-pre-wrap">{org.bio}</p>}
            {org.website && (
              <p>
                <a href={org.website} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                  {org.website}
                </a>
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
