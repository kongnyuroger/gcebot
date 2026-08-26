'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, RotateCw } from 'lucide-react';
import type { ExamLevel } from '@gcebot/shared';
import { SUBJECTS_BY_LEVEL } from '@gcebot/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { useApiClient } from '@/lib/use-api-client';
import { DOC_TYPES, EXAM_LEVELS, type AdminDocument, type PaginatedDocuments } from '@/lib/documents-types';
import { cn } from '@/lib/utils';

const POLL_INTERVAL_MS = 5000;
const PENDING_STATUSES = new Set(['QUEUED', 'PROCESSING']);

const STATUS_STYLES: Record<string, string> = {
  QUEUED: 'bg-gray-200 text-gray-800 border-transparent',
  PROCESSING: 'bg-blue-100 text-blue-800 border-transparent',
  COMPLETE: 'bg-green-100 text-green-800 border-transparent',
  FAILED: 'bg-red-100 text-red-800 border-transparent',
};

const ALL_SUBJECTS = Array.from(
  new Set([...SUBJECTS_BY_LEVEL.O_LEVEL, ...SUBJECTS_BY_LEVEL.A_LEVEL].map((s) => s.name)),
).sort();

interface DocumentsTableProps {
  refreshKey: number;
}

export function DocumentsTable({ refreshKey }: DocumentsTableProps) {
  const api = useApiClient();
  const [data, setData] = useState<PaginatedDocuments | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function load() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (statusFilter) params.set('status', statusFilter);
        if (subjectFilter) params.set('subject', subjectFilter);

        const result = await api.get<PaginatedDocuments>(`/admin/documents?${params.toString()}`);
        if (cancelled) return;

        setData(result);

        const hasPending = result.documents.some((doc) => PENDING_STATUSES.has(doc.ingestionStatus));
        if (hasPending) {
          timer = setTimeout(load, POLL_INTERVAL_MS);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, subjectFilter, refreshKey]);

  async function handleRetry(id: string) {
    await api.post(`/admin/documents/${id}/retry`);
    setData((prev) =>
      prev
        ? {
            ...prev,
            documents: prev.documents.map((doc) =>
              doc.id === id ? { ...doc, ingestionStatus: 'QUEUED', errorMessage: null } : doc,
            ),
          }
        : prev,
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-4">
        <Select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          className="w-48"
        >
          <option value="">All statuses</option>
          <option value="QUEUED">Queued</option>
          <option value="PROCESSING">Processing</option>
          <option value="COMPLETE">Complete</option>
          <option value="FAILED">Failed</option>
        </Select>
        <Select
          aria-label="Filter by subject"
          value={subjectFilter}
          onChange={(event) => setSubjectFilter(event.target.value)}
          className="w-48"
        >
          <option value="">All subjects</option>
          {ALL_SUBJECTS.map((subject) => (
            <option key={subject} value={subject}>
              {subject}
            </option>
          ))}
        </Select>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="w-8 px-4 py-3" />
              <th className="px-4 py-3 font-medium">Filename</th>
              <th className="px-4 py-3 font-medium">Subject</th>
              <th className="px-4 py-3 font-medium">Level</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Year</th>
              <th className="px-4 py-3 font-medium">Paper</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Chunks</th>
              <th className="px-4 py-3 font-medium">Uploaded</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {!data && (
              <tr>
                <td colSpan={11} className="px-4 py-6 text-center text-muted-foreground">
                  Loading...
                </td>
              </tr>
            )}
            {data && data.documents.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-6 text-center text-muted-foreground">
                  No documents yet.
                </td>
              </tr>
            )}
            {data?.documents.map((doc) => (
              <DocumentRow
                key={doc.id}
                doc={doc}
                expanded={expandedId === doc.id}
                onToggleExpand={() => setExpandedId(expandedId === doc.id ? null : doc.id)}
                onRetry={() => handleRetry(doc.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
      {loading && <p className="text-xs text-muted-foreground">Refreshing...</p>}
    </div>
  );
}

function DocumentRow({
  doc,
  expanded,
  onToggleExpand,
  onRetry,
}: {
  doc: AdminDocument;
  expanded: boolean;
  onToggleExpand: () => void;
  onRetry: () => void;
}) {
  const docTypeLabel = DOC_TYPES.find((t) => t.value === doc.docType)?.label ?? doc.docType;
  const levelLabel = EXAM_LEVELS.find((l) => l.value === (doc.level as ExamLevel))?.label ?? doc.level;
  const isFailed = doc.ingestionStatus === 'FAILED';

  return (
    <>
      <tr className="border-t">
        <td className="px-4 py-3">
          {isFailed && (
            <button onClick={onToggleExpand} aria-label="Toggle error details">
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          )}
        </td>
        <td className="px-4 py-3">{doc.filename}</td>
        <td className="px-4 py-3">{doc.subject}</td>
        <td className="px-4 py-3">{levelLabel}</td>
        <td className="px-4 py-3">{docTypeLabel}</td>
        <td className="px-4 py-3">{doc.year ?? '-'}</td>
        <td className="px-4 py-3">{doc.paperNumber ?? '-'}</td>
        <td className="px-4 py-3">
          <Badge
            className={cn(STATUS_STYLES[doc.ingestionStatus])}
            title={doc.errorMessage ?? undefined}
          >
            {doc.ingestionStatus}
          </Badge>
        </td>
        <td className="px-4 py-3">{doc.chunkCount}</td>
        <td className="px-4 py-3">{new Date(doc.createdAt).toLocaleString()}</td>
        <td className="px-4 py-3">
          {isFailed && (
            <Button variant="outline" size="sm" onClick={onRetry} className="gap-1">
              <RotateCw className="h-3 w-3" />
              Retry
            </Button>
          )}
        </td>
      </tr>
      {expanded && isFailed && (
        <tr className="border-t bg-destructive/5">
          <td />
          <td colSpan={10} className="px-4 py-3 text-xs text-destructive">
            {doc.errorMessage ?? 'No error message recorded.'}
          </td>
        </tr>
      )}
    </>
  );
}
