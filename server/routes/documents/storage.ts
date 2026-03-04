/**
 * Document storage — disk helper for local dev.
 *
 * File content is stored in Postgres as `content_bytes` (bytea) for all new uploads.
 * This module handles the disk provider fallback for DOCUMENTS_STORAGE_PROVIDER=disk
 * and reads from disk for legacy rows.
 *
 * Production (Vercel, Neon): DOCUMENTS_STORAGE_PROVIDER is unset or 'db'.
 * Disk ops are no-ops; bytes live in the DB row's content_bytes column.
 */

import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

export function getStorageProvider(): 'disk' | 'db' {
  const val = (process.env.DOCUMENTS_STORAGE_PROVIDER || '').trim().toLowerCase();
  if (val === 'disk') return 'disk';
  return 'db'; // default: store file content in Postgres content_bytes
}

function getStoragePath() {
  return resolve(process.cwd(), (process.env.DOCUMENTS_STORAGE_PATH || 'data/documents').trim());
}

/**
 * Build a deterministic storage key (relative path) for disk provider use.
 * Also serves as a human-readable key stored in storage_key column for disk rows.
 */
export function buildStorageKey(userId: string, docId: string, filename: string): string {
  const ext = String(filename || '').toLowerCase().includes('.')
    ? filename.split('.').pop()!.replace(/[^a-z0-9]/gi, '').slice(0, 10)
    : 'bin';
  return `${userId}/${docId}.${ext}`;
}

/** Write buffer to disk. No-op for 'db' provider (content goes to content_bytes column). */
export async function storeFileToDisk(storageKey: string, buffer: Buffer): Promise<void> {
  if (getStorageProvider() !== 'disk') return;
  const root = getStoragePath();
  const full = resolve(root, storageKey);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, buffer);
}

/**
 * Read file bytes from disk (used for legacy disk-based rows or disk provider).
 * New rows should use doc.contentBytes directly.
 */
export async function readFileFromDisk(storageKey: string): Promise<Buffer> {
  const root = getStoragePath();
  const full = resolve(root, storageKey);
  return readFile(full);
}

/** Delete disk file. Legacy 'db:...' keys are a no-op (nothing on disk). */
export async function deleteFileFromDisk(storageKey: string | null | undefined): Promise<void> {
  if (!storageKey || storageKey.startsWith('db:')) return;
  const root = getStoragePath();
  const full = resolve(root, storageKey);
  if (existsSync(full)) await unlink(full);
}
