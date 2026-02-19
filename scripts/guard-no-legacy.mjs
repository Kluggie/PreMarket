import fs from 'node:fs';
import path from 'node:path';

const ROOTS = ['src', 'api', 'server'];
const FILE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.json']);
const FORBIDDEN_PATTERNS = [
  { label: 'legacyClient', regex: /\blegacyClient\b/ },
  { label: '/api/entities/', regex: /\/api\/entities\// },
  { label: 'legacy_vendor_namespace', regex: /@b[a]se44/i },
  { label: 'legacy_vendor_text', regex: /\bb[a]se44\b/i },
  { label: 'legacy_vendor_request_factory', regex: /createClientFromReq[u]est\(/ },
  { label: 'legacy_vendor_entity_create', regex: /createEntit[y]\(/ },
  { label: 'legacy_vendor_npm_ref', regex: /npm:@b[a]se44/i },
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

    lines.forEach((line, lineIndex) => {
      FORBIDDEN_PATTERNS.forEach((pattern) => {
        if (pattern.regex.test(line)) {
          matches.push(`${filePath}:${lineIndex + 1}: ${pattern.label}: ${line.trim()}`);
        }
      });
    });
  }
}

if (matches.length > 0) {
  console.error('Forbidden legacy references detected in src/, api/, or server/:');
  matches.forEach((match) => {
    console.error(`- ${match}`);
  });
  process.exit(1);
}

console.log('No forbidden legacy references found in src/, api/, and server/.');
