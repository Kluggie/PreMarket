export type PdfBlock = {
  text: string;
  bold?: boolean;
  fontSize?: number;
  gapAfter?: number;
};

export function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function getComparisonId(req: any, comparisonIdParam?: string) {
  if (comparisonIdParam && comparisonIdParam.trim().length > 0) {
    return comparisonIdParam.trim();
  }

  const rawId = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  return String(rawId || '').trim();
}

export function slugify(value: string) {
  return (
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'document-comparison'
  );
}

function sanitizePdfText(value: unknown) {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '?')
    .trim();
}

export function toParagraphs(value: unknown) {
  const normalized = sanitizePdfText(value);
  if (!normalized) {
    return [] as string[];
  }
  return normalized.split(/\n+/g).map((line) => line.trim()).filter(Boolean);
}

export async function renderPdfBuffer(blocks: PdfBlock[]) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({
    unit: 'pt',
    format: 'letter',
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const left = 40;
  const right = 40;
  const maxWidth = pageWidth - left - right;
  let y = 44;

  const writeBlock = (block: PdfBlock) => {
    const text = sanitizePdfText(block.text);
    if (!text) {
      return;
    }

    const fontSize = Number(block.fontSize || 11);
    const lineHeight = Math.max(14, fontSize + 4);
    pdf.setFont('helvetica', block.bold ? 'bold' : 'normal');
    pdf.setFontSize(fontSize);
    const lines = pdf.splitTextToSize(text, maxWidth);

    lines.forEach((line: string) => {
      if (y > pageHeight - 50) {
        pdf.addPage();
        y = 44;
      }
      pdf.text(line, left, y);
      y += lineHeight;
    });

    y += Number(block.gapAfter || 0);
  };

  blocks.forEach(writeBlock);

  return Buffer.from(pdf.output('arraybuffer'));
}

export function sendPdf(res: any, filename: string, buffer: Buffer) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.end(buffer);
}

