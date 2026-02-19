import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Calendar } from 'lucide-react';

export default function ProposalsChart({ sentProposals = [], receivedProposals = [] }) {
  const [timeRange, setTimeRange] = useState('30D');
  const [visibleSeries, setVisibleSeries] = useState({
    sent: true,
    received: true,
    active: true,
    mutual: true
  });

  const timeRanges = [
    { value: '7D', label: '7 Days', days: 7 },
    { value: '30D', label: '30 Days', days: 30 },
    { value: '90D', label: '90 Days', days: 90 },
    { value: '12M', label: '12 Months', days: 365 },
    { value: 'ALL', label: 'All Time', days: 9999 }
  ];

  const chartData = useMemo(() => {
    const selectedRange = timeRanges.find(r => r.value === timeRange);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - selectedRange.days);

    // Generate date buckets
    const buckets = {};
    const daysToShow = Math.min(selectedRange.days, 30); // Max 30 points on chart
    const interval = Math.max(1, Math.floor(selectedRange.days / daysToShow));

    for (let i = daysToShow - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - (i * interval));
      const key = date.toISOString().split('T')[0];
      buckets[key] = {
        date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        sent: 0,
        received: 0,
        active: 0,
        mutual: 0
      };
    }

    // Count proposals by date
    [...sentProposals, ...receivedProposals].forEach(proposal => {
      const proposalDate = new Date(proposal.created_date);
      if (proposalDate < cutoffDate) return;

      const dateKey = proposalDate.toISOString().split('T')[0];
      const bucket = Object.keys(buckets).reduce((prev, curr) => 
        Math.abs(new Date(curr) - proposalDate) < Math.abs(new Date(prev) - proposalDate) ? curr : prev
      );

      if (buckets[bucket]) {
        const isSent = sentProposals.some(p => p.id === proposal.id);
        if (isSent) buckets[bucket].sent++;
        else buckets[bucket].received++;

        if (['sent', 'received', 'under_verification'].includes(proposal.status)) {
          buckets[bucket].active++;
        }
        if (['mutual_interest', 'revealed'].includes(proposal.status)) {
          buckets[bucket].mutual++;
        }
      }
    });

    return Object.values(buckets);
  }, [sentProposals, receivedProposals, timeRange]);

  const toggleSeries = (series) => {
    setVisibleSeries(prev => ({ ...prev, [series]: !prev[series] }));
  };

  const hasData = sentProposals.length > 0 || receivedProposals.length > 0;

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Proposals Activity
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            {timeRanges.map(range => (
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
        {!hasData ? (
          <div className="py-12 text-center">
            <p className="text-slate-500 mb-6">No proposal data to display yet. Create your first proposal to see analytics.</p>
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
                  <XAxis 
                    dataKey="date" 
                    tick={{ fontSize: 12 }}
                    stroke="#94a3b8"
                  />
                  <YAxis 
                    tick={{ fontSize: 12 }}
                    stroke="#94a3b8"
                    allowDecimals={false}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'white', 
                      border: '1px solid #e2e8f0',
                      borderRadius: '8px'
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