'use client';

import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useSession } from 'next-auth/react';
import { UploadCloud, X, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import type { ExamLevel } from '@gcebot/shared';
import { SUBJECTS_BY_LEVEL } from '@gcebot/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { uploadWithProgress } from '@/lib/upload-with-progress';
import { DOC_TYPES, EXAM_LEVELS, type DocType } from '@/lib/documents-types';

type FileEntryStatus = 'pending' | 'uploading' | 'done' | 'error';

interface FileEntry {
  file: File;
  year: string;
  status: FileEntryStatus;
  progress: number;
  error?: string;
}

interface DocumentUploadFormProps {
  onUploaded: () => void;
}

export function DocumentUploadForm({ onUploaded }: DocumentUploadFormProps) {
  const { data: session } = useSession();
  const [level, setLevel] = useState<ExamLevel>('O_LEVEL');
  const [subject, setSubject] = useState('');
  const [docType, setDocType] = useState<DocType>('PAST_PAPER');
  const [topic, setTopic] = useState('');
  const [sharedYear, setSharedYear] = useState('');
  const [sharedPaperNumber, setSharedPaperNumber] = useState('');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [uploading, setUploading] = useState(false);

  const subjectsForLevel = SUBJECTS_BY_LEVEL[level];
  const showPaperNumber = docType === 'PAST_PAPER' || docType === 'MARKING_SCHEME';

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setEntries((prev) => [
      ...prev,
      ...acceptedFiles.map((file) => ({ file, year: '', status: 'pending' as const, progress: 0 })),
    ]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    multiple: true,
  });

  function handleLevelChange(nextLevel: ExamLevel) {
    setLevel(nextLevel);
    // The subject list is level-specific - a subject valid for the previous
    // level may not exist for the new one, so it must be reselected.
    setSubject('');
  }

  function updateEntryYear(index: number, year: string) {
    setEntries((prev) => prev.map((entry, i) => (i === index ? { ...entry, year } : entry)));
  }

  function removeEntry(index: number) {
    setEntries((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleUpload() {
    if (!session?.accessToken || !subject || entries.length === 0 || uploading) {
      return;
    }

    setUploading(true);

    for (let i = 0; i < entries.length; i++) {
      if (entries[i].status === 'done') {
        continue;
      }

      setEntries((prev) =>
        prev.map((entry, idx) => (idx === i ? { ...entry, status: 'uploading', progress: 0 } : entry)),
      );

      const formData = new FormData();
      formData.append('file', entries[i].file);
      formData.append('subject', subject);
      formData.append('level', level);
      formData.append('docType', docType);
      // Per-file year overrides the shared value - lets one batch cover
      // several years of the same subject (e.g. 10 years of past papers).
      const year = entries[i].year || sharedYear;
      if (year) {
        formData.append('year', year);
      }
      if (showPaperNumber && sharedPaperNumber) {
        formData.append('paperNumber', sharedPaperNumber);
      }
      if (topic) {
        formData.append('topic', topic);
      }

      try {
        const result = await uploadWithProgress(
          '/admin/documents/ingest',
          session.accessToken,
          formData,
          (percent) => {
            setEntries((prev) => prev.map((entry, idx) => (idx === i ? { ...entry, progress: percent } : entry)));
          },
        );

        if (result.status >= 200 && result.status < 300) {
          setEntries((prev) =>
            prev.map((entry, idx) => (idx === i ? { ...entry, status: 'done', progress: 100 } : entry)),
          );
        } else {
          const message = (result.body as { message?: string })?.message ?? 'Upload failed';
          setEntries((prev) =>
            prev.map((entry, idx) => (idx === i ? { ...entry, status: 'error', error: message } : entry)),
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Upload failed';
        setEntries((prev) =>
          prev.map((entry, idx) => (idx === i ? { ...entry, status: 'error', error: message } : entry)),
        );
      }
    }

    setUploading(false);
    // Clear the shared year/paper so they can't be silently reused for the
    // next batch of files dropped in this session - forces an explicit choice.
    setSharedYear('');
    setSharedPaperNumber('');
    onUploaded();
  }

  const canUpload = !uploading && subject.length > 0 && entries.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload documents</CardTitle>
        <CardDescription>
          Drop one or more PDFs, set the shared metadata, then upload. Each file can override the
          year individually - handy for uploading several years of one subject at once.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div
          {...getRootProps()}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors',
            isDragActive ? 'border-primary bg-accent' : 'border-input hover:bg-accent/50',
          )}
        >
          <input {...getInputProps()} />
          <UploadCloud className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {isDragActive ? 'Drop the PDFs here' : 'Drag & drop PDFs here, or click to browse'}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label>Level</Label>
            <div className="flex gap-4 pt-2">
              {EXAM_LEVELS.map((option) => (
                <label key={option.value} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="level"
                    value={option.value}
                    checked={level === option.value}
                    onChange={() => handleLevelChange(option.value)}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="subject">Subject</Label>
            <Select id="subject" value={subject} onChange={(event) => setSubject(event.target.value)}>
              <option value="">Select a subject</option>
              {subjectsForLevel.map((option) => (
                <option key={option.id} value={option.name}>
                  {option.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="docType">Document type</Label>
            <Select
              id="docType"
              value={docType}
              onChange={(event) => setDocType(event.target.value as DocType)}
            >
              {DOC_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sharedYear">Year (applies to files with no override)</Label>
            <Input
              id="sharedYear"
              type="number"
              placeholder="e.g. 2023"
              value={sharedYear}
              onChange={(event) => setSharedYear(event.target.value)}
            />
          </div>

          {showPaperNumber && (
            <div className="space-y-2">
              <Label htmlFor="sharedPaperNumber">Paper number</Label>
              <Input
                id="sharedPaperNumber"
                type="number"
                min={1}
                placeholder="e.g. 1"
                value={sharedPaperNumber}
                onChange={(event) => setSharedPaperNumber(event.target.value)}
              />
            </div>
          )}

          <div className="space-y-2 sm:col-span-2 lg:col-span-4">
            <Label htmlFor="topic">Topic (optional)</Label>
            <Input
              id="topic"
              placeholder="e.g. Organic Chemistry"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
            />
          </div>
        </div>

        {entries.length > 0 && (
          <div className="space-y-2">
            {entries.map((entry, index) => (
              <div
                key={`${entry.file.name}-${index}`}
                className="flex items-center gap-3 rounded-md border p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{entry.file.name}</p>
                  {entry.status === 'uploading' || entry.status === 'done' ? (
                    <Progress value={entry.progress} className="mt-1" />
                  ) : entry.status === 'error' ? (
                    <p className="mt-1 text-xs text-destructive">{entry.error}</p>
                  ) : null}
                </div>
                <Input
                  type="number"
                  placeholder="Year override"
                  className="w-32"
                  value={entry.year}
                  disabled={entry.status !== 'pending'}
                  onChange={(event) => updateEntryYear(index, event.target.value)}
                />
                {entry.status === 'done' && <CheckCircle2 className="h-5 w-5 text-green-600" />}
                {entry.status === 'error' && <AlertCircle className="h-5 w-5 text-destructive" />}
                {entry.status === 'uploading' && (
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                )}
                {entry.status === 'pending' && (
                  <Button variant="ghost" size="icon" onClick={() => removeEntry(index)}>
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        <Button onClick={handleUpload} disabled={!canUpload}>
          {uploading ? 'Uploading...' : `Upload ${entries.length || ''} file${entries.length === 1 ? '' : 's'}`}
        </Button>
      </CardContent>
    </Card>
  );
}
