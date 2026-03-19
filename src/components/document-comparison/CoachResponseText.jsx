import React from 'react';

function parseCoachResponseBlocks(value) {
  const lines = String(value || '')
    .replace(/\r/g, '')
    .split('\n');
  const blocks = [];

  let index = 0;
  while (index < lines.length) {
    const rawLine = lines[index] || '';
    const line = rawLine.trim();
    if (!line) {
      index += 1;
      continue;
    }

    const headingMatch = line.match(/^#{1,6}\s+(.*)$/);
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        text: headingMatch[1].trim(),
      });
      index += 1;
      continue;
    }

    const orderedItemMatch = line.match(/^\d+[.)]\s+(.*)$/);
    if (orderedItemMatch) {
      const items = [];
      while (index < lines.length) {
        const orderedLine = String(lines[index] || '').trim();
        const match = orderedLine.match(/^\d+[.)]\s+(.*)$/);
        if (!match) {
          break;
        }
        const itemText = String(match[1] || '').trim();
        if (itemText) {
          items.push(itemText);
        }
        index += 1;
      }
      if (items.length) {
        blocks.push({ type: 'ordered', items });
      }
      continue;
    }

    const bulletItemMatch = line.match(/^[-*]\s+(.*)$/);
    if (bulletItemMatch) {
      const items = [];
      while (index < lines.length) {
        const bulletLine = String(lines[index] || '').trim();
        const match = bulletLine.match(/^[-*]\s+(.*)$/);
        if (!match) {
          break;
        }
        const itemText = String(match[1] || '').trim();
        if (itemText) {
          items.push(itemText);
        }
        index += 1;
      }
      if (items.length) {
        blocks.push({ type: 'unordered', items });
      }
      continue;
    }

    const paragraphLines = [];
    while (index < lines.length) {
      const paragraphLine = String(lines[index] || '');
      const paragraphLineTrimmed = paragraphLine.trim();
      if (!paragraphLineTrimmed) {
        break;
      }
      if (
        /^#{1,6}\s+/.test(paragraphLineTrimmed) ||
        /^\d+[.)]\s+/.test(paragraphLineTrimmed) ||
        /^[-*]\s+/.test(paragraphLineTrimmed)
      ) {
        break;
      }
      paragraphLines.push(paragraphLine);
      index += 1;
    }
    if (paragraphLines.length) {
      blocks.push({
        type: 'paragraph',
        text: paragraphLines.join('\n').trim(),
      });
    } else {
      index += 1;
    }
  }

  return blocks;
}

export default function CoachResponseText({ text = '' }) {
  const blocks = parseCoachResponseBlocks(text);
  if (!blocks.length) {
    return <p className="text-sm leading-6 text-slate-700 whitespace-pre-wrap">{String(text || '').trim()}</p>;
  }

  return (
    <div className="space-y-3">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          return (
            <h4 key={`coach-response-heading-${index}`} className="text-sm font-semibold text-slate-900">
              {block.text}
            </h4>
          );
        }
        if (block.type === 'unordered') {
          return (
            <ul key={`coach-response-unordered-${index}`} className="list-disc space-y-1 pl-5 text-sm leading-6 text-slate-700">
              {block.items.map((item, itemIndex) => (
                <li key={`coach-response-unordered-item-${index}-${itemIndex}`}>{item}</li>
              ))}
            </ul>
          );
        }
        if (block.type === 'ordered') {
          return (
            <ol key={`coach-response-ordered-${index}`} className="list-decimal space-y-1 pl-5 text-sm leading-6 text-slate-700">
              {block.items.map((item, itemIndex) => (
                <li key={`coach-response-ordered-item-${index}-${itemIndex}`}>{item}</li>
              ))}
            </ol>
          );
        }
        return (
          <p key={`coach-response-paragraph-${index}`} className="text-sm leading-6 text-slate-700 whitespace-pre-wrap">
            {block.text}
          </p>
        );
      })}
    </div>
  );
}
