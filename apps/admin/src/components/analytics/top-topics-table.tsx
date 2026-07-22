import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { TopicCount } from '@/lib/analytics-types';

interface TopTopicsTableProps {
  data: TopicCount[];
}

export function TopTopicsTable({ data }: TopTopicsTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Top 10 most-asked topics</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No topic activity in this range.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-2 font-medium">#</th>
                <th className="py-2 font-medium">Topic</th>
                <th className="py-2 text-right font-medium">Questions</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row, index) => (
                <tr key={row.topic} className="border-t">
                  <td className="py-2 text-muted-foreground">{index + 1}</td>
                  <td className="py-2">{row.topic}</td>
                  <td className="py-2 text-right tabular-nums">{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
