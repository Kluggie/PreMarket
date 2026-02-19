import fs from 'node:fs';
import path from 'node:path';

const ROOTS = ['src', 'api'];
const FILE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.json']);
const PATTERNS = [
  { label: '@base44', regex: /@base44\//i },
  { label: 'base44', regex: /\bbase44\b/i },
  { label: 'createClientFromRequest', regex: /createClientFromRequest\(/ },
  { label: 'createEntity', regex: /createEntity\(/ },
  { label: 'npm:@base44', regex: /npm:@base44/i },
];

function walk(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }

    if (FILE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

const matches = [];

for (const root of ROOTS) {
  if (!fs.existsSync(root)) {
    continue;
  }

  const files = walk(root);

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);

    lines.forEach((line, index) => {
      PATTERNS.forEach((pattern) => {
        if (pattern.regex.test(line)) {
          matches.push(`${filePath}:${index + 1}: ${pattern.label}: ${line.trim()}`);
        }
      });
    });
  }
}

if (matches.length > 0) {
  console.error('Base44 references detected in src/ or api/:');
  matches.forEach((match) => {
    console.error(`- ${match}`);
  });
  process.exit(1);
}

console.log('No Base44 references found in src/ and api/.');
