import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..');
const runtimeRoots = [
  path.join(rootDir, 'api'),
  path.join(rootDir, 'server'),
];

function collectRuntimeSourceFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectRuntimeSourceFiles(fullPath));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!/\.(?:ts|js)$/.test(entry.name)) {
      continue;
    }
    files.push(fullPath);
  }

  return files;
}

test('runtime source files do not import .ts extensions directly', () => {
  const offenders = [];
  const importRegex =
    /\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"][^'"]+\.ts['"]|\bimport\s*\(\s*['"][^'"]+\.ts['"]\s*\)/g;

  for (const runtimeRoot of runtimeRoots) {
    for (const filePath of collectRuntimeSourceFiles(runtimeRoot)) {
      const relativePath = path.relative(rootDir, filePath);
      const source = fs.readFileSync(filePath, 'utf8');
      const matches = source.match(importRegex);
      if (matches?.length) {
        offenders.push(`${relativePath}: ${matches.join(' | ')}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Runtime imports must target emitted .js files so the Vercel API bundle can start:\n${offenders.join('\n')}`,
  );
});
