import fs from 'node:fs';
import path from 'node:path';

const ROOTS = ['src', 'api'];
const FILE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.json']);
const PATTERNS = [
  /@base44\//i,
  /\bbase44\b/i,
  /createClientFromRequest\(/,
  /base44\.app/i,
];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }

    const extension = path.extname(entry.name);
    if (FILE_EXTENSIONS.has(extension)) {
      files.push(fullPath);
    }
  }

  return files;
}

const matches = [];

for (const root of ROOTS) {
  if (!fs.existsSync(root)) continue;

  const files = walk(root);

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);

    lines.forEach((line, index) => {
      if (PATTERNS.some((pattern) => pattern.test(line))) {
        matches.push(`${filePath}:${index + 1}:${line.trim()}`);
      }
    });
  }
}

if (matches.length > 0) {
  console.error('Base44 references detected in src/api:');
  for (const match of matches) {
    console.error(`- ${match}`);
  }
  process.exit(1);
}

console.log('No Base44 references found in src/ and api/.');
