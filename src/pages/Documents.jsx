import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { documentsClient } from '@/api/documentsClient';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Loader2,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';

const ALLOWED_LABEL = 'PDF, DOCX, XLSX, PPTX, TXT, MD';
const ALLOWED_ACCEPT = '.pdf,.docx,.xlsx,.pptx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/markdown';
const STATUS_REASON_LABELS = {
  no_text_found: 'No extractable text was found in this file.',
  encrypted_pdf: 'This PDF is encrypted and cannot be processed.',
  extraction_failed: 'Text extraction failed for this file.',
  unsupported_type: 'This file type is not supported for AI extraction.',
  processing_timeout: 'Processing timed out. Try uploading again.',
};
const VISIBILITY_HELP = {
  confidential: 'Used for internal AI evaluation and never shown to the other party.',
  shared: 'May be shown to the other party when attached to a proposal.',
};

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '—';
  }
}

function getFileTypeLabel(filename) {
  const ext = String(filename || '').toLowerCase().split('.').pop() || '';
  const labelMap = { pdf: 'PDF', docx: 'DOCX', xlsx: 'XLSX', pptx: 'PPTX', txt: 'TXT', md: 'MD' };
  return labelMap[ext] || ext.toUpperCase() || 'File';
}

function StatusBadge({ status, statusReason, errorMessage }) {
  if (status === 'ready') {
    return (
      <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 gap-1">
        <CheckCircle2 className="w-3 h-3" /> Usable for AI
      </Badge>
    );
  }
  if (status === 'processing') {
    return (
      <Badge className="bg-amber-50 text-amber-700 border-amber-200 gap-1">
        <Clock className="w-3 h-3" /> Processing...
      </Badge>
    );
  }

  if (status === 'not_supported' || status === 'failed') {
    const reasonText =
      STATUS_REASON_LABELS[statusReason] ||
      (typeof errorMessage === 'string' && errorMessage.trim()) ||
      'This file is not usable for AI analysis.';
    const toneClass =
      status === 'failed'
        ? 'bg-red-50 text-red-700 border-red-200'
        : 'bg-slate-100 text-slate-600 border-slate-200';
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge className={`${toneClass} gap-1 cursor-help`}>
            <XCircle className="w-3 h-3" /> Not usable for AI
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p className="max-w-64 text-xs">{reasonText}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return <Badge variant="outline">{status}</Badge>;
}

function StorageBar({ used, max }) {
  const pct = Math.min(100, Math.round((used / max) * 100));
  const isNearFull = pct >= 80;
  return (
    <div className="w-full bg-slate-200 rounded-full h-2">
      <div
        className={`h-2 rounded-full transition-all ${isNearFull ? 'bg-amber-500' : 'bg-blue-500'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default function Documents() {
  const { user, isLoadingAuth, navigateToLogin } = useAuth();
  const queryClient = useQueryClient();

  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);
  const [updatingVisibilityId, setUpdatingVisibilityId] = useState(null);

  useEffect(() => {
    if (!isLoadingAuth && !user) {
      navigateToLogin('/documents');
    }
  }, [isLoadingAuth, navigateToLogin, user]);

  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ['userDocuments'],
    queryFn: () => documentsClient.list(),
    enabled: Boolean(user),
    refetchInterval: (data) => {
      // Poll while any document is still processing
      const docs = data?.documents || [];
      return docs.some((d) => d.status === 'processing') ? 4000 : false;
    },
  });

  const documents = data?.documents || [];
  const usage = data?.usage || {
    file_count: 0,
    total_bytes: 0,
    max_files: 5,
    max_total_bytes: 10 * 1024 * 1024,
    max_file_bytes: 5 * 1024 * 1024,
  };

  const uploadMutation = useMutation({
    mutationFn: (file) => documentsClient.upload(file),
    onSuccess: () => {
      setUploadError(null);
      queryClient.invalidateQueries({ queryKey: ['userDocuments'] });
    },
    onError: (err) => {
      setUploadError(err?.message || 'Upload failed. Please try again.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => documentsClient.deleteDoc(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userDocuments'] });
    },
    onError: (err) => {
      setUploadError(err?.message || 'Delete failed. Please try again.');
    },
  });

  const updateVisibilityMutation = useMutation({
    mutationFn: ({ id, visibility }) => documentsClient.updateVisibility(id, visibility),
    onMutate: async ({ id, visibility }) => {
      await queryClient.cancelQueries({ queryKey: ['userDocuments'] });
      const previousData = queryClient.getQueryData(['userDocuments']);
      queryClient.setQueryData(['userDocuments'], (current) => {
        if (!current) return current;
        return {
          ...current,
          documents: (current.documents || []).map((doc) =>
            doc.id === id ? { ...doc, visibility } : doc,
          ),
        };
      });
      return { previousData };
    },
    onError: (err, _variables, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(['userDocuments'], context.previousData);
      }
      setUploadError(err?.message || 'Failed to update document visibility.');
    },
    onSuccess: (updatedDoc) => {
      queryClient.setQueryData(['userDocuments'], (current) => {
        if (!current) return current;
        return {
          ...current,
          documents: (current.documents || []).map((doc) =>
            doc.id === updatedDoc.id ? { ...doc, ...updatedDoc } : doc,
          ),
        };
      });
    },
  });

  const validateAndUpload = useCallback(
    (file) => {
      setUploadError(null);

      if (!documentsClient.isAllowedType(file)) {
        setUploadError(`Unsupported file type: "${file.name}". Allowed: ${ALLOWED_LABEL}.`);
        return;
      }

      if (file.size > usage.max_file_bytes) {
        setUploadError(
          `"${file.name}" is too large (${formatBytes(file.size)}). Max per file: ${formatBytes(usage.max_file_bytes)}.`,
        );
        return;
      }

      if (usage.file_count >= usage.max_files) {
        setUploadError(
          `You've reached the limit of ${usage.max_files} files. Delete a file before uploading another.`,
        );
        return;
      }

      if (usage.total_bytes + file.size > usage.max_total_bytes) {
        const remaining = usage.max_total_bytes - usage.total_bytes;
        setUploadError(
          `Upload would exceed your 10 MB storage limit. You have ${formatBytes(remaining)} remaining.`,
        );
        return;
      }

      uploadMutation.mutate(file);
    },
    [uploadMutation, usage],
  );

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) validateAndUpload(file);
    e.target.value = '';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) validateAndUpload(file);
  };

  const handleDelete = async (id) => {
    setDeletingId(id);
    try {
      await deleteMutation.mutateAsync(id);
    } finally {
      setDeletingId(null);
    }
  };

  const handleDownload = async (doc) => {
    setDownloadingId(doc.id);
    try {
      await documentsClient.download(doc.id, doc.filename);
    } catch (err) {
      setUploadError(err?.message || 'Download failed.');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleVisibilityChange = async (doc, nextVisibility) => {
    const currentVisibility = doc?.visibility || 'confidential';
    if (!doc?.id || currentVisibility === nextVisibility) return;

    setUpdatingVisibilityId(doc.id);
    try {
      await updateVisibilityMutation.mutateAsync({
        id: doc.id,
        visibility: nextVisibility,
      });
    } finally {
      setUpdatingVisibilityId(null);
    }
  };

  if (isLoadingAuth) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">

          {/* Header */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-slate-900">Documents</h1>
            <p className="mt-1 text-sm text-slate-500">
              Upload supporting materials to provide extra context for evaluations.
            </p>
          </div>

          {/* Storage indicator */}
          <Card className="mb-6">
            <CardContent className="pt-5 pb-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-slate-500 mb-1.5">Storage usage</p>
                  <StorageBar used={usage.total_bytes} max={usage.max_total_bytes} />
                  <p className="mt-1.5 text-xs text-slate-600">
                    {formatBytes(usage.total_bytes)} / {formatBytes(usage.max_total_bytes)} used
                    &nbsp;·&nbsp;
                    {usage.file_count} / {usage.max_files} files
                  </p>
                </div>
                <div className="shrink-0">
                  <Button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadMutation.isPending}
                    className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
                    size="sm"
                  >
                    {uploadMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4" />
                    )}
                    Upload file
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ALLOWED_ACCEPT}
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

        {/* Upload drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`mb-6 border-2 border-dashed rounded-xl py-10 px-6 flex flex-col items-center justify-center cursor-pointer transition-colors
            ${dragOver
              ? 'border-blue-400 bg-blue-50'
              : 'border-slate-200 bg-white hover:border-blue-300 hover:bg-slate-50'
            }`}
        >
          <Upload className={`w-8 h-8 mb-3 ${dragOver ? 'text-blue-500' : 'text-slate-400'}`} />
          <p className="text-sm font-medium text-slate-700">
            {dragOver ? 'Drop file to upload' : 'Drag & drop or click to upload'}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {ALLOWED_LABEL} &nbsp;·&nbsp; Max 5 files &nbsp;·&nbsp; 10 MB total
          </p>
        </div>

        {/* Error banner */}
        {uploadError && (
          <div className="mb-5 flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
            <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-red-700">{uploadError}</p>
            </div>
            <button
              onClick={() => setUploadError(null)}
              className="shrink-0 text-red-400 hover:text-red-600"
              aria-label="Dismiss"
            >
              <XCircle className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Document list */}
        <div className="space-y-3">
          {isLoading ? (
            <Card>
              <CardContent className="py-12 flex flex-col items-center text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin mb-2" />
                <p className="text-sm">Loading documents…</p>
              </CardContent>
            </Card>
          ) : loadError ? (
            <Card>
              <CardContent className="py-10 flex flex-col items-center text-slate-400">
                <AlertCircle className="w-6 h-6 mb-2 text-red-400" />
                <p className="text-sm text-red-600">Failed to load documents. Try refreshing.</p>
              </CardContent>
            </Card>
          ) : documents.length === 0 ? (
            <Card>
              <CardContent className="py-14 flex flex-col items-center text-slate-400">
                <FileText className="w-10 h-10 mb-3 text-slate-200" />
                <p className="text-sm font-medium text-slate-500">No documents uploaded yet</p>
                <p className="mt-1 text-xs text-slate-400">
                  Upload a file above to get started.
                </p>
              </CardContent>
            </Card>
          ) : (
            documents.map((doc) => (
              <Card key={doc.id} className="overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="shrink-0 w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center mt-0.5">
                        <FileText className="w-4 h-4 text-slate-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate" title={doc.filename}>
                          {doc.filename}
                        </p>
                        <div className="flex flex-wrap gap-2 mt-1.5 items-center">
                          <span className="text-xs font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                            {getFileTypeLabel(doc.filename)}
                          </span>
                          <span className="text-slate-200">·</span>
                          <span className="text-xs text-slate-400">{formatBytes(doc.size_bytes)}</span>
                          <span className="text-slate-200">·</span>
                          <span className="text-xs text-slate-400">{formatDate(doc.created_at)}</span>
                          <span className="text-slate-200">·</span>
                          <StatusBadge
                            status={doc.status}
                            statusReason={doc.status_reason}
                            errorMessage={doc.error_message}
                          />
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="text-xs text-slate-500">Visibility</span>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                size="sm"
                                variant={(doc.visibility || 'confidential') === 'confidential' ? 'default' : 'outline'}
                                className={
                                  (doc.visibility || 'confidential') === 'confidential'
                                    ? 'h-7 px-2.5 text-xs bg-slate-800 hover:bg-slate-700'
                                    : 'h-7 px-2.5 text-xs text-slate-600'
                                }
                                onClick={() => handleVisibilityChange(doc, 'confidential')}
                                disabled={updatingVisibilityId === doc.id}
                              >
                                Confidential
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="max-w-64 text-xs">{VISIBILITY_HELP.confidential}</p>
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                size="sm"
                                variant={(doc.visibility || 'confidential') === 'shared' ? 'default' : 'outline'}
                                className={
                                  (doc.visibility || 'confidential') === 'shared'
                                    ? 'h-7 px-2.5 text-xs bg-blue-600 hover:bg-blue-700'
                                    : 'h-7 px-2.5 text-xs text-slate-600'
                                }
                                onClick={() => handleVisibilityChange(doc, 'shared')}
                                disabled={updatingVisibilityId === doc.id}
                              >
                                Shared
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="max-w-64 text-xs">{VISIBILITY_HELP.shared}</p>
                            </TooltipContent>
                          </Tooltip>
                          {updatingVisibilityId === doc.id ? (
                            <span className="text-xs text-slate-400 inline-flex items-center gap-1">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Saving...
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 text-slate-600"
                        disabled={downloadingId === doc.id}
                        onClick={() => handleDownload(doc)}
                        title="Download"
                      >
                        {downloadingId === doc.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Download className="w-4 h-4" />
                        )}
                        <span className="hidden sm:inline">Download</span>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 text-red-600 hover:bg-red-50 hover:border-red-200"
                        disabled={deletingId === doc.id}
                        onClick={() => handleDelete(doc.id)}
                        title="Delete"
                      >
                        {deletingId === doc.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                        <span className="hidden sm:inline">Delete</span>
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        {/* Upload spinner overlay (in case uploading takes time) */}
        {uploadMutation.isPending && (
          <div className="mt-4 flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <Loader2 className="w-4 h-4 animate-spin text-blue-600 shrink-0" />
            <p className="text-sm text-blue-700">Uploading and processing…</p>
          </div>
        )}
        </div>
      </div>
    </TooltipProvider>
  );
}
