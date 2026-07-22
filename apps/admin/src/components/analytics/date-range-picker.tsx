'use client';

import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { DateRangePreset } from '@/lib/analytics-types';

const PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: 'custom', label: 'Custom range' },
];

interface DateRangePickerProps {
  preset: DateRangePreset;
  onPresetChange: (preset: DateRangePreset) => void;
  customFrom: string;
  customTo: string;
  onCustomFromChange: (value: string) => void;
  onCustomToChange: (value: string) => void;
}

// Date range presets sit in a single row above every chart/stat below it -
// everything on the page re-renders against the same slice, so the numbers
// always agree (see the dataviz skill's interaction.md).
export function DateRangePicker({
  preset,
  onPresetChange,
  customFrom,
  customTo,
  onCustomFromChange,
  onCustomToChange,
}: DateRangePickerProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {PRESETS.map((option) => (
        <Button
          key={option.value}
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            'gap-1.5',
            preset === option.value && 'border-primary bg-accent text-accent-foreground',
          )}
          onClick={() => onPresetChange(option.value)}
        >
          {preset === option.value && <Check className="h-4 w-4" />}
          {option.label}
        </Button>
      ))}
      {preset === 'custom' && (
        <div className="flex items-center gap-2 border-l pl-3">
          <Input
            type="date"
            value={customFrom}
            onChange={(event) => onCustomFromChange(event.target.value)}
            className="w-40"
          />
          <span className="text-sm text-muted-foreground">to</span>
          <Input
            type="date"
            value={customTo}
            onChange={(event) => onCustomToChange(event.target.value)}
            className="w-40"
          />
        </div>
      )}
    </div>
  );
}
