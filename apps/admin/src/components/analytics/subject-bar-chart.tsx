'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CHART_BLUE } from '@/lib/chart-colors';
import type { SubjectCount } from '@/lib/analytics-types';

interface SubjectBarChartProps {
  data: SubjectCount[];
}

// "Compare magnitude across subjects" is a magnitude job, not an identity
// job - one hue, sequential-by-height, rather than a different color per
// subject (which would need the full categorical treatment for no benefit).
//
// isAnimationActive={false} on the Bar below: see messages-line-chart.tsx -
// recharts' default mount animation can get stuck at its initial (empty)
// frame in some rendering environments, leaving real bars permanently
// unrendered. Skipping it makes the data visible immediately.
export function SubjectBarChart({ data }: SubjectBarChartProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Questions per subject</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#e1e0d9" strokeDasharray="0" vertical={false} />
            <XAxis
              dataKey="subject"
              tick={{ fill: '#898781', fontSize: 12 }}
              axisLine={{ stroke: '#c3c2b7' }}
              tickLine={false}
              interval={0}
              angle={-20}
              textAnchor="end"
              height={50}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fill: '#898781', fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              width={32}
            />
            <Tooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
            <Bar
              dataKey="count"
              name="Questions"
              fill={CHART_BLUE}
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
