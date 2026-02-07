import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Search, MapPin } from 'lucide-react';

const PAGE_SIZE = 20;

function DirectoryCard({ item }) {
  const isPerson = item.kind === 'person';
  const href = isPerson ? `/directory/people/${item.id}` : `/directory/orgs/${item.id}`;
  const subtitle = isPerson ? item.title || item.user_type : item.type;

  return (
    <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-lg truncate">{item.displayName}</CardTitle>
          <Badge variant="secondary" className="whitespace-nowrap">
            {isPerson ? 'Individual' : 'Organization'}
          </Badge>
        </div>
        {subtitle && <CardDescription className="capitalize">{String(subtitle).replace(/_/g, ' ')}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2 text-xs">
          {item.industry && <Badge variant="outline">{item.industry}</Badge>}
          {item.location && (
            <Badge variant="outline" className="flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {item.location}
            </Badge>
          )}
        </div>
        {item.bio && <p className="text-sm text-slate-600 line-clamp-3">{item.bio}</p>}
        <Link to={href}>
          <Button variant="outline" size="sm" className="w-full">
            View Profile
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}

export default function Directory() {
  const [mode, setMode] = useState('both');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    industry: '',
    location: '',
  });

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setPage(1);
  }, [mode, debouncedQuery, filters.industry, filters.location]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['publicDirectorySearch', mode, debouncedQuery, filters, page, PAGE_SIZE],
    queryFn: async () => {
      const response = await base44.functions.invoke('PublicDirectorySearch', {
        mode,
        q: debouncedQuery,
        filters,
        page,
        pageSize: PAGE_SIZE,
      });
      return response?.data || { totalCount: 0, items: [], facets: {} };
    },
  });

  const totalCount = data?.totalCount || 0;
  const items = data?.items || [];
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const facets = useMemo(
    () => ({
      industries: data?.facets?.industries || [],
      locations: data?.facets?.locations || [],
    }),
    [data],
  );

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Public Directory</h1>
          <p className="text-slate-600 mt-1">Browse public profiles and organizations in PreMarket.</p>
        </div>

        <Card className="border-0 shadow-sm">
          <CardContent className="pt-6 space-y-4">
            <Tabs value={mode} onValueChange={setMode}>
              <TabsList>
                <TabsTrigger value="both">Both</TabsTrigger>
                <TabsTrigger value="people">Individuals</TabsTrigger>
                <TabsTrigger value="orgs">Organizations</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name..."
                className="pl-9"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Select value={filters.industry || 'all'} onValueChange={(value) => setFilters((prev) => ({ ...prev, industry: value === 'all' ? '' : value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Industry" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All industries</SelectItem>
                  {facets.industries.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filters.location || 'all'} onValueChange={(value) => setFilters((prev) => ({ ...prev, location: value === 'all' ? '' : value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Location" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All locations</SelectItem>
                  {facets.locations.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-52 rounded-xl bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <Card className="border border-red-200 bg-red-50">
            <CardContent className="py-6 text-red-700">Failed to load directory.</CardContent>
          </Card>
        ) : items.length === 0 ? (
          <Card className="border-dashed border-slate-300">
            <CardContent className="py-10 text-center text-slate-600">No public entries match these filters.</CardContent>
          </Card>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-600">{totalCount} result{totalCount === 1 ? '' : 's'}</p>
              <div className="text-sm text-slate-500">
                {page} / {totalPages}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {items.map((item) => (
                <DirectoryCard key={`${item.kind}-${item.id}`} item={item} />
              ))}
            </div>
            <div className="flex items-center justify-center gap-2 pt-2">
              <Button variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                Previous
              </Button>
              <Button variant="outline" onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages}>
                Next
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
