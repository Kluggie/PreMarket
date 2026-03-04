import { request } from '@/api/httpClient';

const MAX_FILE_BYTES = 5 * 1024 * 1024;   // 5 MB
const MAX_TOTAL_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_FILES = 5;

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',    // docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',          // xlsx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',  // pptx
  'text/plain',
  'text/markdown',
]);

const ALLOWED_EXTENSIONS = new Set(['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'md']);

function getExtension(filename) {
  const parts = String(filename || '').toLowerCase().split('.');
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export const documentsClient = {
  LIMITS: { MAX_FILE_BYTES, MAX_TOTAL_BYTES, MAX_FILES },

  isAllowedType(file) {
    const ext = getExtension(file.name);
    return ALLOWED_MIME_TYPES.has(file.type) || ALLOWED_EXTENSIONS.has(ext);
  },

  async list() {
    const response = await request('/api/documents');
    return {
      documents: response.documents || [],
      usage: response.usage || {
        file_count: 0,
        total_bytes: 0,
        max_files: MAX_FILES,
        max_total_bytes: MAX_TOTAL_BYTES,
        max_file_bytes: MAX_FILE_BYTES,
      },
    };
  },

  async upload(file) {
    const base64 = await fileToBase64(file);
    const response = await request('/api/documents/upload', {
      method: 'POST',
      body: JSON.stringify({
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        fileBase64: base64,
      }),
    });
    return response.document;
  },

  async download(id, filename) {
    const response = await fetch(`/api/documents/${encodeURIComponent(id)}/download`, {
      credentials: 'include',
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const error = new Error(body?.error?.message || 'Download failed');
      error.status = response.status;
      throw error;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'document';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      document.body.removeChild(a);
    }, 1000);
  },

  async deleteDoc(id) {
    await request(`/api/documents/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },
};
