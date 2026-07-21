import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FUNNEL_STEPS } from '@/lib/chart-colors';

interface ConversionFunnelProps {
  registered: number;
  activated: number;
  paying: number;
}

const STAGES = ['Registered', 'Activated', 'Paying'] as const;

// An ordered-scale funnel: each stage one step further along the same blue
// ramp (the dataviz skill's "ordinal ramp" pattern), width proportional to
// its share of the top of the funnel so the drop-off is visible at a glance.
export function ConversionFunnel({ registered, activated, paying }: ConversionFunnelProps) {
  const values = [registered, activated, paying];
  const base = registered || 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Conversion funnel</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {STAGES.map((stage, index) => {
          const value = values[index];
          const percent = Math.round((value / base) * 100);
          return (
            <div key={stage} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{stage}</span>
                <span className="text-muted-foreground">
                  {value} ({percent}%)
                </span>
              </div>
              <div className="h-6 w-full overflow-hidden rounded-md bg-secondary">
                <div
                  className="h-full rounded-md transition-all"
                  style={{ width: `${Math.max(percent, 2)}%`, backgroundColor: FUNNEL_STEPS[index] }}
                />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
