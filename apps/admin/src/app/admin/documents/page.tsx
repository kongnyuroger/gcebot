'use client';

import { useState } from 'react';
import { DocumentUploadForm } from '@/components/documents/document-upload-form';
import { DocumentsTable } from '@/components/documents/documents-table';

export default function DocumentsPage() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Documents</h1>
      <DocumentUploadForm onUploaded={() => setRefreshKey((key) => key + 1)} />
      <DocumentsTable refreshKey={refreshKey} />
    </div>
  );
}
