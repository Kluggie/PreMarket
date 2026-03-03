import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { directoryClient } from '@/api/directoryClient';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Search, MapPin } from 'lucide-react';

const PAGE_SIZE = 20;
const DEFAULT_MODE = 'both';
const DEFAULT_SORT = 'relevance';
const DEFAULT_FILTERS = {
  industry: '',
  location: '',
};
const SORT_OPTIONS = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'recently_active', label: 'Recently active' },
  { value: 'newest', label: 'Newest' },
  { value: 'az', label: 'A-Z' },
];

function parseDateValue(value) {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizeText(value) {
  return String(value ?? '').trim().toLowerCase();
}

function formatLabel(value) {
  return String(value ?? '')
    .trim()
    .replace(/[_-]+/g, ' ');
}

function getDisplayName(item) {
  return String(item?.displayName || item?.name || 'Unnamed');
}

function compareByName(a, b) {
  return normalizeText(getDisplayName(a)).localeCompare(normalizeText(getDisplayName(b)));
}

function getRecentlyActiveSortValue(item) {
  return (
    parseDateValue(item?.lastActiveAt) ||
    parseDateValue(item?.updatedAt) ||
    parseDateValue(item?.createdAt)
  );
}

function getNewestSortValue(item) {
  return parseDateValue(item?.createdAt);
}

function DirectoryCard({ item }) {
  const isPerson = item.kind === 'person';
  const href = isPerson ? `/directory/people/${item.id}` : `/directory/orgs/${item.id}`;
  const companyName = item.companyName || item.organizationName || item.company || item.orgName;
  const secondary = isPerson
    ? (item.title ? `${item.title}${companyName ? ` at ${companyName}` : ''}` : formatLabel(item.user_type))
    : (formatLabel(item.type) || item.industry || '');
  const tagline = String(item.tagline || item.bio || '').trim() || 'No tagline provided.';
  const kindLabel = isPerson ? 'Person' : 'Company';

  return (
    <Link to={href} className="block h-full">
      <Card className="h-full border-0 shadow-sm hover:shadow-md transition-shadow">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-lg leading-tight line-clamp-1">{getDisplayName(item)}</CardTitle>
            <div className="flex items-center gap-2 shrink-0">
              {item.verified ? (
                <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Verified</Badge>
              ) : null}
              <Badge variant="secondary" className="whitespace-nowrap">
                {kindLabel}
              </Badge>
            </div>
          </div>
          {secondary && <CardDescription className="line-clamp-1">{secondary}</CardDescription>}
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
          <p className="text-sm text-slate-600 line-clamp-1">{tagline}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function Directory() {
  const [mode, setMode] = useState(DEFAULT_MODE);
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState(() => ({ ...DEFAULT_FILTERS }));

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setPage(1);
  }, [mode, debouncedQuery, filters.industry, filters.location, sort]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['publicDirectorySearch', mode, debouncedQuery, filters.industry, filters.location, sort, page, PAGE_SIZE],
    queryFn: () =>
      directoryClient.search({
        mode,
        q: debouncedQuery,
        filters,
        sort,
        page,
        pageSize: PAGE_SIZE,
      }),
  });

  const totalCount = data?.totalCount || 0;
  const rawItems = data?.items || [];
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const facets = useMemo(
    () => ({
      industries: data?.facets?.industries || [],
      locations: data?.facets?.locations || [],
    }),
    [data],
  );

  const items = useMemo(() => {
    if (sort === 'relevance') {
      return rawItems;
    }

    const sorted = [...rawItems];

    if (sort === 'recently_active') {
      sorted.sort((a, b) => {
        const diff = getRecentlyActiveSortValue(b) - getRecentlyActiveSortValue(a);
        if (diff !== 0) return diff;
        return compareByName(a, b);
      });
      return sorted;
    }

    if (sort === 'newest') {
      sorted.sort((a, b) => {
        const diff = getNewestSortValue(b) - getNewestSortValue(a);
        if (diff !== 0) return diff;
        return compareByName(a, b);
      });
      return sorted;
    }

    sorted.sort((a, b) => {
      const nameDiff = compareByName(a, b);
      if (nameDiff !== 0) return nameDiff;
      return getRecentlyActiveSortValue(b) - getRecentlyActiveSortValue(a);
    });
    return sorted;
  }, [rawItems, sort]);

  const hasDirtyFilters =
    mode !== DEFAULT_MODE ||
    query.trim().length > 0 ||
    Boolean(filters.industry) ||
    Boolean(filters.location) ||
    sort !== DEFAULT_SORT;

  const clearFilters = () => {
    setMode(DEFAULT_MODE);
    setSort(DEFAULT_SORT);
    setQuery('');
    setDebouncedQuery('');
    setFilters({ ...DEFAULT_FILTERS });
    setPage(1);
  };

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
                <TabsTrigger value="both">All</TabsTrigger>
                <TabsTrigger value="people">People</TabsTrigger>
                <TabsTrigger value="orgs">Companies</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name or keywords..."
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

            <div className="border-t border-slate-100 pt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-600">
                Showing {totalCount} result{totalCount === 1 ? '' : 's'}
              </p>
              <div className="flex items-center gap-2 self-start sm:self-auto">
                {hasDirtyFilters && (
                  <Button variant="ghost" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                )}
                <Select value={sort} onValueChange={setSort}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Sort by" />
                  </SelectTrigger>
                  <SelectContent>
                    {SORT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {items.map((item) => (
                <DirectoryCard key={`${item.kind}-${item.id}`} item={item} />
              ))}
            </div>
            <div className="flex items-center justify-center gap-2 pt-2">
              <Button variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                Previous
              </Button>
              <div className="text-sm text-slate-500 px-1">
                {page} / {totalPages}
              </div>
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
