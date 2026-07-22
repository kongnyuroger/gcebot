'use client';

import { useEffect, useState } from 'react';
import { useApiClient } from '@/lib/use-api-client';
import type { AnalyticsResult, DateRangePreset } from '@/lib/analytics-types';
import { DateRangePicker } from '@/components/analytics/date-range-picker';
import { MetricCard } from '@/components/analytics/metric-card';
import { MessagesLineChart } from '@/components/analytics/messages-line-chart';
import { SubjectBarChart } from '@/components/analytics/subject-bar-chart';
import { ConversionFunnel } from '@/components/analytics/conversion-funnel';
import { TopTopicsTable } from '@/components/analytics/top-topics-table';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function computeRange(
  preset: DateRangePreset,
  customFrom: string,
  customTo: string,
): { from: string; to: string } {
  if (preset === 'custom') {
    // Bare dates from the <input type="date"> pickers - the API treats a
    // bare "to" date as extending through the end of that day.
    return { from: customFrom, to: customTo };
  }

  // Precise timestamps (not date-only) for preset ranges, so "last 7 days"
  // genuinely includes everything up to this exact moment rather than
  // truncating to midnight and silently dropping today's activity.
  const to = new Date();
  const from = new Date(to.getTime() - Number(preset) * MS_PER_DAY);
  return { from: from.toISOString(), to: to.toISOString() };
}

function formatFcfa(amount: number): string {
  return `${new Intl.NumberFormat('en-US').format(amount)} FCFA`;
}

export default function AnalyticsPage() {
  const api = useApiClient();
  const [preset, setPreset] = useState<DateRangePreset>('30');
  const [customFrom, setCustomFrom] = useState(toISODate(new Date(Date.now() - 30 * MS_PER_DAY)));
  const [customTo, setCustomTo] = useState(toISODate(new Date()));
  const [data, setData] = useState<AnalyticsResult | null>(null);

  const { from, to } = computeRange(preset, customFrom, customTo);

  useEffect(() => {
    if (!from || !to) return;

    let cancelled = false;
    api.get<AnalyticsResult>(`/admin/analytics?from=${from}&to=${to}`).then((result) => {
      if (!cancelled) setData(result);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  const latestDau = data && data.dau.length > 0 ? data.dau[data.dau.length - 1] : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <DateRangePicker
          preset={preset}
          onPresetChange={setPreset}
          customFrom={customFrom}
          customTo={customTo}
          onCustomFromChange={setCustomFrom}
          onCustomToChange={setCustomTo}
        />
      </div>

      {!data ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Daily active users" value={String(latestDau)} />
            <MetricCard label="Total messages" value={String(data.totalMessages)} />
            <MetricCard label="New users" value={String(data.newUsers)} />
            <MetricCard label="Revenue" value={formatFcfa(data.revenue)} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <MessagesLineChart data={data.messagesPerDay} />
            <SubjectBarChart data={data.questionsPerSubject} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ConversionFunnel
              registered={data.conversionFunnel.registered}
              activated={data.conversionFunnel.activated}
              paying={data.conversionFunnel.paying}
            />
            <TopTopicsTable data={data.topTopics} />
          </div>
        </>
      )}
    </div>
  );
}
