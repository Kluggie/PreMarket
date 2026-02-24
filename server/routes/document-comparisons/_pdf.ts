export type PdfSection = {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
};

export type PdfDocument = {
  title: string;
  subtitle: string;
  comparisonId?: string | null;
  generatedAt?: Date;
  sections: PdfSection[];
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

function normalizePdfText(value: unknown) {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201C|\u201D/g, '"')
    .replace(/\u2013/g, '-')
    .replace(/\u2014/g, '--')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')
    .replace(/\u2022/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '')
    .trim();
}

function toSafeLines(value: unknown) {
  return normalizePdfText(value)
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizeBullet(value: unknown) {
  return normalizePdfText(value).replace(/^[-*+\d.() ]+/, '').trim();
}

export function toParagraphs(value: unknown) {
  return toSafeLines(value);
}

function formatGeneratedAt(value: Date) {
  return value.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export async function renderProfessionalPdfBuffer(document: PdfDocument) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({
    unit: 'pt',
    format: 'a4',
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const marginLeft = 52;
  const marginRight = 52;
  const marginTop = 56;
  const marginBottom = 56;
  const textWidth = pageWidth - marginLeft - marginRight;
  const contentBottom = pageHeight - marginBottom - 20;

  let y = marginTop;

  const ensureSpace = (requiredHeight: number) => {
    if (y + requiredHeight <= contentBottom) {
      return;
    }
    pdf.addPage();
    y = marginTop;
  };

  const writeWrappedLine = ({
    text,
    fontSize = 11,
    bold = false,
    color = [15, 23, 42],
    indent = 0,
    lineHeight,
    gapAfter = 0,
  }: {
    text: string;
    fontSize?: number;
    bold?: boolean;
    color?: [number, number, number];
    indent?: number;
    lineHeight?: number;
    gapAfter?: number;
  }) => {
    const safeText = normalizePdfText(text);
    if (!safeText) {
      return;
    }

    const resolvedLineHeight = Number(lineHeight || Math.max(15, fontSize + 4));
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setTextColor(color[0], color[1], color[2]);
    pdf.setFontSize(fontSize);

    const maxWidth = Math.max(80, textWidth - indent);
    const lines = pdf.splitTextToSize(safeText, maxWidth);
    ensureSpace(lines.length * resolvedLineHeight + gapAfter + 2);

    lines.forEach((line: string) => {
      pdf.text(line, marginLeft + indent, y);
      y += resolvedLineHeight;
    });
    y += gapAfter;
  };

  const generatedAt = document.generatedAt || new Date();

  writeWrappedLine({
    text: document.title || 'Document Comparison',
    fontSize: 20,
    bold: true,
    lineHeight: 26,
    gapAfter: 8,
  });
  writeWrappedLine({
    text: document.subtitle || '',
    fontSize: 12,
    color: [71, 85, 105],
    gapAfter: 4,
  });
  writeWrappedLine({
    text: `Generated: ${formatGeneratedAt(generatedAt)}`,
    fontSize: 10,
    color: [100, 116, 139],
    gapAfter: 2,
  });
  if (asText(document.comparisonId)) {
    writeWrappedLine({
      text: `Comparison ID: ${asText(document.comparisonId)}`,
      fontSize: 10,
      color: [100, 116, 139],
      gapAfter: 10,
    });
  } else {
    y += 8;
  }

  pdf.setDrawColor(226, 232, 240);
  pdf.setLineWidth(1);
  pdf.line(marginLeft, y, pageWidth - marginRight, y);
  y += 18;

  const sections = Array.isArray(document.sections) ? document.sections : [];
  sections.forEach((section, sectionIndex) => {
    if (sectionIndex > 0) {
      y += 6;
    }

    writeWrappedLine({
      text: section.heading || `Section ${sectionIndex + 1}`,
      fontSize: 14,
      bold: true,
      lineHeight: 20,
      gapAfter: 6,
    });

    const paragraphs = Array.isArray(section.paragraphs) ? section.paragraphs : [];
    paragraphs.forEach((paragraph, paragraphIndex) => {
      writeWrappedLine({
        text: paragraph,
        fontSize: 11,
        lineHeight: 16,
        gapAfter: paragraphIndex === paragraphs.length - 1 ? 6 : 4,
      });
    });

    const bullets = Array.isArray(section.bullets) ? section.bullets : [];
    bullets.forEach((bullet, bulletIndex) => {
      const normalized = normalizeBullet(bullet);
      if (!normalized) {
        return;
      }
      writeWrappedLine({
        text: `• ${normalized}`,
        fontSize: 11,
        lineHeight: 16,
        indent: 6,
        gapAfter: bulletIndex === bullets.length - 1 ? 6 : 2,
      });
    });
  });

  const totalPages = pdf.getNumberOfPages();
  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
    pdf.setPage(pageNumber);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(100, 116, 139);
    pdf.text(`Page ${pageNumber} of ${totalPages}`, pageWidth / 2, pageHeight - 24, {
      align: 'center',
    });
  }

  return Buffer.from(pdf.output('arraybuffer'));
}

export function sendPdf(res: any, filename: string, buffer: Buffer) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.end(buffer);
}
