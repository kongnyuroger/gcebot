'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useApiClient } from '@/lib/use-api-client';
import { maskPhone, SUBSCRIPTION_TIERS, type SubscriptionTier, type UserDetail } from '@/lib/users-types';

interface UserDetailDrawerProps {
  phone: string | null;
  onClose: () => void;
  onTierUpdated: () => void;
}

export function UserDetailDrawer({ phone, onClose, onTierUpdated }: UserDetailDrawerProps) {
  const api = useApiClient();
  const { data: session } = useSession();
  const isSuperAdmin = session?.user?.role === 'SUPER_ADMIN';

  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [selectedTier, setSelectedTier] = useState<SubscriptionTier>('FREE');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!phone) {
      setDetail(null);
      return;
    }

    let cancelled = false;
    api.get<UserDetail>(`/admin/users/${phone}`).then((data) => {
      if (cancelled) return;
      setDetail(data);
      setSelectedTier(data.tier);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone]);

  async function handleSaveTier() {
    if (!phone) return;
    setSaving(true);
    try {
      await api.patch(`/admin/users/${phone}/tier`, { tier: selectedTier });
      setDetail((prev) => (prev ? { ...prev, tier: selectedTier } : prev));
      onTierUpdated();
    } finally {
      setSaving(false);
    }
  }

  const topicRows = detail?.topicScores
    ? Object.entries(detail.topicScores).flatMap(([subject, topics]) =>
        Object.entries(topics).map(([topic, score]) => ({
          subject,
          topic,
          ...score,
          accuracy: score.total > 0 ? Math.round((score.correct / score.total) * 100) : 0,
        })),
      )
    : [];

  return (
    <Dialog open={phone !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {!detail ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{maskPhone(detail.phone_number)}</DialogTitle>
              <DialogDescription>
                {detail.level} - joined {new Date(detail.createdAt).toLocaleDateString()}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-1">
              <p className="text-sm font-medium">Subjects</p>
              <div className="flex flex-wrap gap-1">
                {detail.subjects.map((subject) => (
                  <Badge key={subject} variant="secondary">
                    {subject}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <p className="text-sm font-medium">Tier</p>
              {isSuperAdmin ? (
                <div className="flex gap-2">
                  <Select
                    aria-label="Change tier"
                    value={selectedTier}
                    onChange={(event) => setSelectedTier(event.target.value as SubscriptionTier)}
                    className="w-40"
                  >
                    {SUBSCRIPTION_TIERS.map((tier) => (
                      <option key={tier} value={tier}>
                        {tier}
                      </option>
                    ))}
                  </Select>
                  <Button
                    size="sm"
                    onClick={handleSaveTier}
                    disabled={saving || selectedTier === detail.tier}
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </Button>
                </div>
              ) : (
                <Badge>{detail.tier}</Badge>
              )}
            </div>

            <div className="space-y-1">
              <p className="text-sm font-medium">Streak</p>
              <p className="text-sm text-muted-foreground">{detail.streakDays} days</p>
            </div>

            {detail.subscription && (
              <div className="space-y-1">
                <p className="text-sm font-medium">Subscription</p>
                <p className="text-sm text-muted-foreground">
                  {detail.subscription.tier} - expires{' '}
                  {new Date(detail.subscription.endDate).toLocaleDateString()}
                </p>
              </div>
            )}

            {topicRows.length > 0 && (
              <div className="space-y-2 overflow-y-auto">
                <p className="text-sm font-medium">Per-topic accuracy</p>
                <div className="space-y-1">
                  {topicRows.map((row) => (
                    <div
                      key={`${row.subject}-${row.topic}`}
                      className="flex items-center justify-between text-sm"
                    >
                      <span>
                        {row.subject} - {row.topic}
                      </span>
                      <span className="text-muted-foreground">
                        {row.correct}/{row.total} ({row.accuracy}%)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex-1 space-y-2 overflow-y-auto">
              <p className="text-sm font-medium">Recent interactions</p>
              {detail.recentInteractions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No interactions yet.</p>
              ) : (
                <div className="space-y-2">
                  {detail.recentInteractions.map((interaction) => (
                    <div key={interaction.id} className="rounded-md border p-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">
                          {interaction.subject} - {interaction.topic}
                        </span>
                        <Badge
                          variant={
                            interaction.correct === null
                              ? 'outline'
                              : interaction.correct
                                ? 'default'
                                : 'destructive'
                          }
                        >
                          {interaction.correct === null ? 'N/A' : interaction.correct ? 'Correct' : 'Wrong'}
                        </Badge>
                      </div>
                      <p className="mt-1 text-muted-foreground">
                        {new Date(interaction.createdAt).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
