import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export default function DirectoryPersonDetail() {
  const { id } = useParams();

  const { data, isLoading, error } = useQuery({
    queryKey: ['publicDirectoryPerson', id],
    queryFn: async () => {
      const response = await base44.functions.invoke('PublicDirectoryGetDetail', { kind: 'person', id });
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
              <p className="text-slate-700">This profile is not available in the public directory.</p>
              <Link to="/directory">
                <Button variant="outline">Back to Directory</Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const person = data.item;

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-3xl mx-auto px-4 space-y-4">
        <Link to="/directory" className="inline-block">
          <Button variant="outline" size="sm">Back to Directory</Button>
        </Link>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-2xl">{person.displayName}</CardTitle>
              <Badge>Individual</Badge>
            </div>
            {person.title && <CardDescription>{person.title}</CardDescription>}
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-2">
              {person.user_type && <Badge variant="secondary">{person.user_type}</Badge>}
              {person.industry && <Badge variant="secondary">{person.industry}</Badge>}
              {person.location && <Badge variant="secondary">{person.location}</Badge>}
            </div>
            {person.bio && <p className="text-slate-700 whitespace-pre-wrap">{person.bio}</p>}
            {person.website && (
              <p>
                <a
                  href={person.website}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  {person.website}
                </a>
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
