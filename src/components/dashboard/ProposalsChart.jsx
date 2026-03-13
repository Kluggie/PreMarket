import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { AlertCircle, Calendar } from 'lucide-react';
import { dashboardClient } from '@/api/dashboardClient';

export default function ProposalsChart() {
  const [timeRange, setTimeRange] = useState('30');
  const [visibleSeries, setVisibleSeries] = useState({
    newThreads: true,
    activeRounds: true,
    closedThreads: true,
    archivedThreads: true,
  });

  const timeRanges = [
    { value: '7', label: '7 Days' },
    { value: '30', label: '30 Days' },
    { value: '90', label: '90 Days' },
    { value: '365', label: '12 Months' },
    { value: 'all', label: 'All Time' },
  ];

  const { data, isLoading, isError: activityError, error: activityErrorObj, refetch: refetchActivity } = useQuery({
    queryKey: ['dashboard-activity', timeRange],
    queryFn: () => dashboardClient.getActivity(timeRange),
    retry: 2,
  });

  const chartData = Array.isArray(data?.points) ? data.points : [];
  const hasData = chartData.some((point) => {
    return (
      Number(point.new_threads || 0) > 0 ||
      Number(point.active_rounds || 0) > 0 ||
      Number(point.closed_threads || 0) > 0 ||
      Number(point.archived_threads || 0) > 0
    );
  });

  const toggleSeries = (series) => {
    setVisibleSeries((prev) => ({ ...prev, [series]: !prev[series] }));
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Thread Activity
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            {timeRanges.map((range) => (
              <Button
                key={range.value}
                variant={timeRange === range.value ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTimeRange(range.value)}
                className={timeRange === range.value ? 'bg-blue-600 hover:bg-blue-700' : ''}
              >
                {range.label}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-12 text-center">
            <p className="text-slate-500">Loading activity chart...</p>
          </div>
        ) : activityError ? (
          <div className="py-10 text-center space-y-2">
            <AlertCircle className="w-6 h-6 text-amber-500 mx-auto" />
            <p className="text-sm text-slate-600">
              Could not load activity chart.{' '}
              <button type="button" className="underline text-blue-600" onClick={() => refetchActivity()}>
                Retry
              </button>
            </p>
            {activityErrorObj?.message && (
              <p className="text-xs text-slate-400">{activityErrorObj.message}</p>
            )}
          </div>
        ) : !hasData ? (
          <div className="py-12 text-center">
            <p className="text-slate-500 mb-6">
              No proposal activity yet. New threads, live negotiation rounds, closures, and archived activity will appear here.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-6 flex flex-wrap gap-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="new-threads-series"
                  checked={visibleSeries.newThreads}
                  onCheckedChange={() => toggleSeries('newThreads')}
                />
                <Label htmlFor="new-threads-series" className="flex items-center gap-2 cursor-pointer">
                  <div className="w-3 h-3 rounded-full bg-blue-500" />
                  New Threads
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="active-rounds-series"
                  checked={visibleSeries.activeRounds}
                  onCheckedChange={() => toggleSeries('activeRounds')}
                />
                <Label htmlFor="active-rounds-series" className="flex items-center gap-2 cursor-pointer">
                  <div className="w-3 h-3 rounded-full bg-amber-500" />
                  Active Rounds
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="closed-threads-series"
                  checked={visibleSeries.closedThreads}
                  onCheckedChange={() => toggleSeries('closedThreads')}
                />
                <Label htmlFor="closed-threads-series" className="flex items-center gap-2 cursor-pointer">
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  Threads Closed
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="archived-threads-series"
                  checked={visibleSeries.archivedThreads}
                  onCheckedChange={() => toggleSeries('archivedThreads')}
                />
                <Label htmlFor="archived-threads-series" className="flex items-center gap-2 cursor-pointer">
                  <div className="w-3 h-3 rounded-full bg-slate-500" />
                  Threads Archived
                </Label>
              </div>
            </div>

            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                  <YAxis tick={{ fontSize: 12 }} stroke="#94a3b8" allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'white',
                      border: '1px solid #e2e8f0',
                      borderRadius: '8px',
                    }}
                  />
                  {visibleSeries.newThreads && (
                    <Line
                      type="monotone"
                      dataKey="new_threads"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={{ fill: '#3b82f6', r: 3 }}
                      activeDot={{ r: 5 }}
                      name="New Threads"
                    />
                  )}
                  {visibleSeries.activeRounds && (
                    <Line
                      type="monotone"
                      dataKey="active_rounds"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      dot={{ fill: '#f59e0b', r: 3 }}
                      activeDot={{ r: 5 }}
                      name="Active Rounds"
                    />
                  )}
                  {visibleSeries.closedThreads && (
                    <Line
                      type="monotone"
                      dataKey="closed_threads"
                      stroke="#10b981"
                      strokeWidth={2}
                      dot={{ fill: '#10b981', r: 3 }}
                      activeDot={{ r: 5 }}
                      name="Threads Closed"
                    />
                  )}
                  {visibleSeries.archivedThreads && (
                    <Line
                      type="monotone"
                      dataKey="archived_threads"
                      stroke="#64748b"
                      strokeWidth={2}
                      dot={{ fill: '#64748b', r: 3 }}
                      activeDot={{ r: 5 }}
                      name="Threads Archived"
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
