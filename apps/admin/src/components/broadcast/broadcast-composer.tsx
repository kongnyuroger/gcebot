'use client';

import { useEffect, useMemo, useState } from 'react';
import { SUBJECTS_BY_LEVEL, SUPPORTED_EXAM_LEVELS } from '@gcebot/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useApiClient } from '@/lib/use-api-client';
import { SUBSCRIPTION_TIERS } from '@/lib/users-types';
import { BROADCAST_TARGETS, MESSAGE_MAX_LENGTH, type Broadcast, type BroadcastTarget } from '@/lib/broadcast-types';

const ALL_SUBJECTS = Array.from(
  new Set([...SUBJECTS_BY_LEVEL.O_LEVEL, ...SUBJECTS_BY_LEVEL.A_LEVEL].map((subject) => subject.name)),
).sort();

interface BroadcastComposerProps {
  onSent: () => void;
}

export function BroadcastComposer({ onSent }: BroadcastComposerProps) {
  const api = useApiClient();
  const [message, setMessage] = useState('');
  const [target, setTarget] = useState<BroadcastTarget>('ALL');
  const [targetValue, setTargetValue] = useState('');
  const [scheduleAt, setScheduleAt] = useState('');
  const [estimate, setEstimate] = useState<number | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetValueOptions = useMemo(() => {
    switch (target) {
      case 'TIER':
        return SUBSCRIPTION_TIERS;
      case 'SUBJECT':
        return ALL_SUBJECTS;
      case 'LEVEL':
        return [...SUPPORTED_EXAM_LEVELS];
      default:
        return [];
    }
  }, [target]);

  useEffect(() => {
    setTargetValue('');
    setEstimate(null);
  }, [target]);

  useEffect(() => {
    if (target !== 'ALL' && !targetValue) {
      setEstimate(null);
      return;
    }

    let cancelled = false;
    setEstimating(true);
    const params = new URLSearchParams({ target });
    if (targetValue) params.set('targetValue', targetValue);

    api
      .get<{ count: number }>(`/admin/broadcast/estimate?${params.toString()}`)
      .then((result) => {
        if (!cancelled) setEstimate(result.count);
      })
      .finally(() => {
        if (!cancelled) setEstimating(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, targetValue]);

  const canSubmit = message.trim().length > 0 && message.length <= MESSAGE_MAX_LENGTH && (target === 'ALL' || targetValue !== '');

  async function handleConfirmSend() {
    setSending(true);
    setError(null);
    try {
      await api.post<Broadcast>('/admin/broadcast', {
        message,
        target,
        targetValue: target === 'ALL' ? undefined : targetValue,
        scheduleAt: scheduleAt ? new Date(scheduleAt).toISOString() : undefined,
      });
      setMessage('');
      setTarget('ALL');
      setTargetValue('');
      setScheduleAt('');
      setEstimate(null);
      setConfirmOpen(false);
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send broadcast');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-4 rounded-md border p-4">
      <div className="space-y-2">
        <Label htmlFor="broadcast-message">Message</Label>
        <textarea
          id="broadcast-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={4}
          placeholder="Write the message to broadcast..."
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
        <p
          className={
            message.length > MESSAGE_MAX_LENGTH ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'
          }
        >
          {message.length}/{MESSAGE_MAX_LENGTH}
        </p>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="space-y-2">
          <Label htmlFor="broadcast-target">Target</Label>
          <Select
            id="broadcast-target"
            value={target}
            onChange={(event) => setTarget(event.target.value as BroadcastTarget)}
            className="w-40"
          >
            {BROADCAST_TARGETS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </div>

        {target !== 'ALL' && (
          <div className="space-y-2">
            <Label htmlFor="broadcast-target-value">{target === 'TIER' ? 'Tier' : target === 'SUBJECT' ? 'Subject' : 'Level'}</Label>
            <Select
              id="broadcast-target-value"
              value={targetValue}
              onChange={(event) => setTargetValue(event.target.value)}
              className="w-48"
            >
              <option value="">Select...</option>
              {targetValueOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="broadcast-schedule">Schedule (optional)</Label>
          <Input
            id="broadcast-schedule"
            type="datetime-local"
            value={scheduleAt}
            onChange={(event) => setScheduleAt(event.target.value)}
            className="w-56"
          />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {estimating ? 'Estimating recipients...' : estimate !== null ? `${estimate} recipient${estimate === 1 ? '' : 's'}` : ''}
        </p>
        <Button disabled={!canSubmit} onClick={() => setConfirmOpen(true)}>
          {scheduleAt ? 'Schedule broadcast' : 'Send broadcast'}
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm broadcast</DialogTitle>
            <DialogDescription>
              This will send a WhatsApp message to{' '}
              {estimate !== null ? `${estimate} recipient${estimate === 1 ? '' : 's'}` : 'the matching recipients'}
              {scheduleAt ? ` at ${new Date(scheduleAt).toLocaleString()}` : ', immediately'}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <p className="text-sm font-medium">Message preview</p>
            <p className="whitespace-pre-wrap rounded-md border bg-muted/50 p-3 text-sm">{message}</p>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={sending}>
              Cancel
            </Button>
            <Button onClick={handleConfirmSend} disabled={sending}>
              {sending ? 'Sending...' : 'Confirm'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
