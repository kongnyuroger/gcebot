'use client';

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CHART_BLUE } from '@/lib/chart-colors';
import type { DailyCount } from '@/lib/analytics-types';

interface MessagesLineChartProps {
  data: DailyCount[];
}

function formatDateTick(value: string): string {
  const date = new Date(value);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// A single series needs no legend box (the card title already says what's
// plotted) - just the line, a recessive grid, and a hover tooltip that shows
// the exact value at the nearest date (recharts' built-in crosshair).
//
// isAnimationActive={false}: recharts' default mount animation (stroke-dasharray
// drawing the line in) can get stuck at its 0%-drawn initial frame in some
// rendering environments, leaving a real, correctly-computed line permanently
// invisible - verified while building this page. Skipping the animation makes
// the data visible immediately and removes a decorative-only effect.
export function MessagesLineChart({ data }: MessagesLineChartProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Messages per day</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#e1e0d9" strokeDasharray="0" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={formatDateTick}
              tick={{ fill: '#898781', fontSize: 12 }}
              axisLine={{ stroke: '#c3c2b7' }}
              tickLine={false}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fill: '#898781', fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              width={32}
            />
            <Tooltip labelFormatter={(value) => formatDateTick(String(value))} />
            <Line
              type="monotone"
              dataKey="count"
              name="Messages"
              stroke={CHART_BLUE}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, stroke: '#fcfcfb', strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
