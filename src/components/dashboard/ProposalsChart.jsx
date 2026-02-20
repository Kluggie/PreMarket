import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Calendar } from 'lucide-react';
import { dashboardClient } from '@/api/dashboardClient';

export default function ProposalsChart() {
  const [timeRange, setTimeRange] = useState('30');
  const [visibleSeries, setVisibleSeries] = useState({
    sent: true,
    received: true,
    active: true,
    mutual: true,
  });

  const timeRanges = [
    { value: '7', label: '7 Days' },
    { value: '30', label: '30 Days' },
    { value: '90', label: '90 Days' },
    { value: '365', label: '12 Months' },
    { value: 'all', label: 'All Time' },
  ];

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-activity', timeRange],
    queryFn: () => dashboardClient.getActivity(timeRange),
  });

  const chartData = Array.isArray(data?.points) ? data.points : [];
  const hasData = chartData.some((point) => {
    return (
      Number(point.sent || 0) > 0 ||
      Number(point.received || 0) > 0 ||
      Number(point.active || 0) > 0 ||
      Number(point.mutual || 0) > 0
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
            Proposals Activity
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
        ) : !hasData ? (
          <div className="py-12 text-center">
            <p className="text-slate-500 mb-6">
              No proposal activity yet. Create your first proposal to see analytics.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-6 flex flex-wrap gap-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="sent-series"
                  checked={visibleSeries.sent}
                  onCheckedChange={() => toggleSeries('sent')}
                />
                <Label htmlFor="sent-series" className="flex items-center gap-2 cursor-pointer">
                  <div className="w-3 h-3 rounded-full bg-blue-500" />
                  Sent
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="received-series"
                  checked={visibleSeries.received}
                  onCheckedChange={() => toggleSeries('received')}
                />
                <Label htmlFor="received-series" className="flex items-center gap-2 cursor-pointer">
                  <div className="w-3 h-3 rounded-full bg-indigo-500" />
                  Received
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="active-series"
                  checked={visibleSeries.active}
                  onCheckedChange={() => toggleSeries('active')}
                />
                <Label htmlFor="active-series" className="flex items-center gap-2 cursor-pointer">
                  <div className="w-3 h-3 rounded-full bg-amber-500" />
                  Active Reviews
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="mutual-series"
                  checked={visibleSeries.mutual}
                  onCheckedChange={() => toggleSeries('mutual')}
                />
                <Label htmlFor="mutual-series" className="flex items-center gap-2 cursor-pointer">
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  Mutual Interest
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
                  {visibleSeries.sent && (
                    <Line
                      type="monotone"
                      dataKey="sent"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={{ fill: '#3b82f6', r: 3 }}
                      activeDot={{ r: 5 }}
                      name="Sent"
                    />
                  )}
                  {visibleSeries.received && (
                    <Line
                      type="monotone"
                      dataKey="received"
                      stroke="#6366f1"
                      strokeWidth={2}
                      dot={{ fill: '#6366f1', r: 3 }}
                      activeDot={{ r: 5 }}
                      name="Received"
                    />
                  )}
                  {visibleSeries.active && (
                    <Line
                      type="monotone"
                      dataKey="active"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      dot={{ fill: '#f59e0b', r: 3 }}
                      activeDot={{ r: 5 }}
                      name="Active"
                    />
                  )}
                  {visibleSeries.mutual && (
                    <Line
                      type="monotone"
                      dataKey="mutual"
                      stroke="#10b981"
                      strokeWidth={2}
                      dot={{ fill: '#10b981', r: 3 }}
                      activeDot={{ r: 5 }}
                      name="Mutual Interest"
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
