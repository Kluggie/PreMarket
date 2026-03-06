export type PdfSection = {
  heading: string;
  /** 1 = major group header  2 = subsection (default) */
  level?: 1 | 2;
  paragraphs?: string[];
  bullets?: string[];
  /** Force a page break before this section. */
  breakBefore?: boolean;
  /** Small italic caption rendered below the heading. */
  caption?: string;
  /** Render content as a highlighted callout box instead of plain text. */
  callout?: boolean;
};

/** Optional decision summary panel rendered at the top of an AI Report PDF. */
export type PdfDecisionPanel = {
  fitLevelDisplay: string;  // e.g. 'High' | 'Medium' | 'Low'
  confidence: number;       // 0–100
  recommendation: string;   // e.g. 'Medium'
  decisionStatus: string;   // e.g. 'PROCEED WITH CONDITIONS'
  fitColor: [number, number, number]; // RGB for the status label
  /** Short sentence explaining the reasoning behind the decision status. */
  decisionContext?: string;
  /** 2–4 short bullet phrases that explain the primary reasons for the recommendation. */
  primaryDrivers?: string[];
};

export type PdfDocument = {
  title: string;
  subtitle: string;
  comparisonId?: string | null;
  generatedAt?: Date;
  /** Optional decision panel rendered at the top of the report (AI Report only). */
  decisionPanel?: PdfDecisionPanel;
  /** Short note shown on the left side of the footer. */
  footerNote?: string;
  sections: PdfSection[];
};

/**
 * Splits a prose paragraph into individual bullet strings by detecting
 * sentence boundaries (`. ` followed by an uppercase letter).  Entries
 * that are already short (<= 120 chars) are left as-is so callers can
 * choose whether to use this helper at all.
 */
export function splitIntoBullets(text: string): string[] {
  const safe = normalizePdfText(text);
  if (!safe) return [];
  // Split on sentence-ending '. ' before an uppercase word
  const raw = safe.split(/(?<=\.)\s+(?=[A-Z])/);
  return raw
    .map((s) => s.replace(/\.$/, '').trim())
    .filter((s) => s.length > 0);
}

/**
 * Parses a block of raw text into {heading, paragraphs?} sections by
 * detecting heading-lines: short lines (<=80 chars) that do NOT end with
 * a period and are followed by body text.  Used by the proposal PDF builder.
 */
export function parseTextIntoSections(
  rawText: string,
  defaultHeading: string,
): Array<{ heading: string; paragraphs: string[] }> {
  const lines = normalizePdfText(rawText)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const result: Array<{ heading: string; paragraphs: string[] }> = [];
  let currentHeading = defaultHeading;
  let currentParagraphs: string[] = [];

  const isHeadingLine = (line: string) =>
    line.length <= 80 &&
    !line.endsWith('.') &&
    !line.endsWith(',') &&
    !line.endsWith(':') &&
    // "Label: Value" style lines (e.g. "CRM: Salesforce") are content, not headings
    !line.includes(': ') &&
    // Must look like a title: starts with uppercase
    /^[A-Z]/.test(line) &&
    // Exclude lines with common prose function words that indicate a sentence
    !/\b(we|our|the|a |an |is |are |was |were |has |have |will |can |to |in |of |for |and |but |with|must|what|which)/.test(line);

  for (const line of lines) {
    if (isHeadingLine(line) && currentParagraphs.length > 0) {
      result.push({ heading: currentHeading, paragraphs: [...currentParagraphs] });
      currentHeading = line;
      currentParagraphs = [];
    } else {
      currentParagraphs.push(line);
    }
  }
  if (currentParagraphs.length > 0) {
    result.push({ heading: currentHeading, paragraphs: currentParagraphs });
  }
  return result.length > 0 ? result : [{ heading: defaultHeading, paragraphs: lines }];
}

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
  return normalizePdfText(value).replace(/^[-*+\d.()\u2022 ]+/, '').trim();
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

// ── Design tokens ─────────────────────────────────────────────────────────────

const C = {
  headerBg:    [15,  23,  42]  as [number, number, number],  // slate-900
  headerText:  [255, 255, 255] as [number, number, number],
  headerMeta:  [100, 116, 139] as [number, number, number],  // slate-500
  indigo:      [99,  102, 241] as [number, number, number],  // indigo-500
  indigoDark:  [30,  27,  75]  as [number, number, number],  // indigo-950
  indigoDeep:  [30,  58,  138] as [number, number, number],  // indigo-900
  bodyText:    [15,  23,  42]  as [number, number, number],  // slate-900
  bodyMuted:   [51,  65,  85]  as [number, number, number],  // slate-700
  label:       [100, 116, 139] as [number, number, number],  // slate-500
  panelBg:     [248, 250, 252] as [number, number, number],  // slate-50
  calloutBg:   [239, 246, 255] as [number, number, number],  // blue-50
  borderLight: [226, 232, 240] as [number, number, number],  // slate-200
  borderMid:   [203, 213, 225] as [number, number, number],  // slate-300
  divL1:       [226, 232, 240] as [number, number, number],
  divL2:       [241, 245, 249] as [number, number, number],
};

export async function renderProfessionalPdfBuffer(document: PdfDocument): Promise<Buffer> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });

  const pageWidth  = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const mL = 52;
  const mR = 52;
  const mT = 56;
  const mB = 56;
  const colW = pageWidth - mL - mR;
  const contentBottom = pageHeight - mB - 28;
  const runHdrH = 22;

  let y = 0;

  // ── Drawing helpers ───────────────────────────────────────────────────────

  const ensureSpace = (h: number, forceBreak = false) => {
    if (forceBreak || y + h > contentBottom) {
      pdf.addPage();
      y = mT + runHdrH;
    }
  };

  const fillRect = (x: number, ry: number, w: number, h: number, rgb: [number,number,number]) => {
    pdf.setFillColor(rgb[0], rgb[1], rgb[2]);
    pdf.rect(x, ry, w, h, 'F');
  };

  const strokeRect = (x: number, ry: number, w: number, h: number, rgb: [number,number,number], lw = 0.5) => {
    pdf.setDrawColor(rgb[0], rgb[1], rgb[2]);
    pdf.setLineWidth(lw);
    pdf.rect(x, ry, w, h, 'S');
  };

  const hLine = (x1: number, x2: number, yPos: number, rgb: [number,number,number], lw = 0.5) => {
    pdf.setDrawColor(rgb[0], rgb[1], rgb[2]);
    pdf.setLineWidth(lw);
    pdf.line(x1, yPos, x2, yPos);
  };

  const setFont = (wt: 'normal' | 'bold' | 'italic', sz: number, rgb: [number,number,number]) => {
    pdf.setFont('helvetica', wt);
    pdf.setFontSize(sz);
    pdf.setTextColor(rgb[0], rgb[1], rgb[2]);
  };

  /** Wrap and emit text, advancing y. */
  const emit = (opts: {
    text: string;
    x: number;
    maxW: number;
    fz: number;
    wt?: 'normal' | 'bold' | 'italic';
    rgb?: [number,number,number];
    lh: number;
    gapAfter?: number;
  }) => {
    const safe = normalizePdfText(opts.text);
    if (!safe) return;
    pdf.setFont('helvetica', opts.wt ?? 'normal');
    pdf.setFontSize(opts.fz);
    const c = opts.rgb ?? C.bodyText;
    pdf.setTextColor(c[0], c[1], c[2]);
    const lines: string[] = pdf.splitTextToSize(safe, opts.maxW);
    ensureSpace(lines.length * opts.lh + (opts.gapAfter ?? 0));
    lines.forEach((line: string) => { pdf.text(line, opts.x, y); y += opts.lh; });
    if (opts.gapAfter) y += opts.gapAfter;
  };

  // ── Page 1: full-bleed dark header band ──────────────────────────────────

  const BAND_H = 68;
  fillRect(0, 0, pageWidth, BAND_H, C.headerBg);

  const titleSafe = normalizePdfText(document.title || 'Document Comparison');
  setFont('bold', 17, C.headerText);
  const tLines: string[] = pdf.splitTextToSize(titleSafe, colW - 10);
  pdf.text(tLines[0] ?? titleSafe, mL, 27);

  const subtitleUpper = normalizePdfText(document.subtitle ?? '').toUpperCase();
  if (subtitleUpper) {
    setFont('bold', 8, C.indigo);
    pdf.text(subtitleUpper, mL, 43);
  }

  const generatedAt = document.generatedAt || new Date();
  const metaText = normalizePdfText(
    `Generated ${formatGeneratedAt(generatedAt)}` +
    (asText(document.comparisonId) ? `   |   ID: ${asText(document.comparisonId)}` : ''),
  );
  setFont('normal', 7.5, C.headerMeta);
  pdf.text(metaText, mL, 57);

  y = BAND_H + 14;

  // ── Decision panel (AI Report only) ──────────────────────────────────────

  const dp = document.decisionPanel;
  if (dp) {
    const driversArr = Array.isArray(dp.primaryDrivers) ? dp.primaryDrivers : [];
    const ctxSafe = normalizePdfText(dp.decisionContext ?? '');

    pdf.setFontSize(9);
    const ctxWrapped: string[] = ctxSafe
      ? (pdf.splitTextToSize(ctxSafe, colW - 30) as string[])
      : [];
    const ctxH = ctxWrapped.length > 0 ? 10 + ctxWrapped.length * 14 : 0;

    let driversH = 0;
    if (driversArr.length > 0) {
      driversH = 14;
      driversArr.forEach((d) => {
        const dSafe = normalizePdfText(d);
        if (!dSafe) return;
        pdf.setFontSize(9);
        const dl: string[] = pdf.splitTextToSize(dSafe, colW - 42);
        driversH += dl.length * 16 + 2;
      });
    }

    const panelH = 14 + 46 + 14 + 12 + 18 + ctxH + (driversArr.length > 0 ? 8 + driversH : 0) + 14;

    const px = mL;
    const py = y;
    const pw = colW;
    const innerX = px + 18;
    const innerW = pw - 26;

    fillRect(px, py, pw, panelH, C.panelBg);
    fillRect(px, py, 5, panelH, dp.fitColor);
    strokeRect(px, py, pw, panelH, C.borderMid);

    y = py + 14;

    // 3-column metric row
    const metrics: [string, string][] = [
      ['FIT LEVEL',      dp.fitLevelDisplay],
      ['CONFIDENCE',     `${dp.confidence}%`],
      ['RECOMMENDATION', dp.recommendation],
    ];
    const chipW = innerW / 3;
    metrics.forEach(([label, value], i) => {
      const cx = innerX + i * chipW;
      if (i > 0) {
        pdf.setDrawColor(C.borderLight[0], C.borderLight[1], C.borderLight[2]);
        pdf.setLineWidth(0.5);
        pdf.line(cx, y - 6, cx, y + 34);
      }
      setFont('normal', 7, C.label);
      pdf.text(label, cx + 4, y);
      setFont('bold', 13, C.bodyText);
      pdf.text(value, cx + 4, y + 18);
    });
    y += 44;

    hLine(innerX, px + pw - 8, y, C.borderLight);
    y += 12;

    // Decision status
    setFont('normal', 7, C.label);
    pdf.text('DECISION STATUS', innerX, y);
    y += 12;

    fillRect(innerX, y - 13, 4, 16, dp.fitColor);
    setFont('bold', 12, dp.fitColor);
    pdf.text(normalizePdfText(dp.decisionStatus), innerX + 8, y);
    y += 6;

    // Context sentence
    if (ctxWrapped.length > 0) {
      y += 10;
      setFont('normal', 9, C.bodyMuted);
      ctxWrapped.forEach((line: string) => { pdf.text(line, innerX + 4, y); y += 14; });
    }

    // WHY THIS DECISION
    if (driversArr.length > 0) {
      y += 8;
      setFont('bold', 7, C.label);
      pdf.text('WHY THIS DECISION', innerX, y);
      y += 14;
      driversArr.forEach((driver) => {
        const safe = normalizePdfText(driver);
        if (!safe) return;
        pdf.setFontSize(9);
        const dLines: string[] = pdf.splitTextToSize(safe, innerW - 18);
        setFont('normal', 9, dp.fitColor);
        pdf.text('\u2013', innerX + 2, y);
        setFont('normal', 9, C.bodyMuted);
        dLines.forEach((dl: string) => { pdf.text(dl, innerX + 12, y); y += 16; });
        y += 2;
      });
    }

    y = py + panelH + 16;
  }

  // ── Sections ──────────────────────────────────────────────────────────────

  const sections = Array.isArray(document.sections) ? document.sections : [];

  sections.forEach((section, idx) => {
    const level = section.level ?? 2;
    const isL1 = level === 1;

    if (section.breakBefore) {
      ensureSpace(9999, true);
    } else if (isL1 && idx > 0) {
      ensureSpace(80);
      y += 8;
      hLine(mL, pageWidth - mR, y, C.divL1);
      y += 14;
    } else if (!isL1 && idx > 0) {
      ensureSpace(50);
      y += 6;
      hLine(mL + 4, pageWidth - mR, y, C.divL2);
      y += 10;
    }

    // Level 1 heading — shaded band
    if (isL1) {
      const hUpper = normalizePdfText(
        (section.heading || `Section ${idx + 1}`).toUpperCase(),
      );
      const bandY = y - 12;
      ensureSpace(26);
      fillRect(mL, bandY, colW, 22, C.panelBg);
      fillRect(mL, bandY, 4, 22, C.indigo);
      setFont('bold', 10.5, C.indigoDark);
      pdf.text(hUpper, mL + 12, y);
      y += 16;

      if (section.caption) {
        emit({ text: section.caption, x: mL + 12, maxW: colW - 16, fz: 8, wt: 'italic', rgb: C.label, lh: 12, gapAfter: 3 });
      }
      if (!section.paragraphs?.length && !section.bullets?.length) return;
    } else {
      // Level 2 heading
      const h2safe = normalizePdfText(section.heading || `Section ${idx + 1}`);
      pdf.setFontSize(11);
      const h2lines: string[] = pdf.splitTextToSize(h2safe, colW - 8);
      ensureSpace(h2lines.length * 15 + 10);
      setFont('bold', 11, C.indigoDeep);
      h2lines.forEach((line: string) => { pdf.text(line, mL + 4, y); y += 15; });
      y += 2;

      if (section.caption) {
        emit({ text: section.caption, x: mL + 4, maxW: colW - 12, fz: 8, wt: 'italic', rgb: C.label, lh: 12, gapAfter: 2 });
      }
    }

    const bodyX = isL1 ? mL + 12 : mL + 8;
    const bodyW = colW - (isL1 ? 16 : 12);

    // Callout box
    if (section.callout && section.paragraphs?.length) {
      const safe = normalizePdfText(section.paragraphs.join(' '));
      pdf.setFontSize(10);
      const boxLines: string[] = pdf.splitTextToSize(safe, bodyW - 22);
      const boxH = boxLines.length * 14 + 20;
      ensureSpace(boxH + 10);
      fillRect(bodyX, y, bodyW, boxH, C.calloutBg);
      strokeRect(bodyX, y, bodyW, boxH, C.indigo, 0.75);
      fillRect(bodyX, y, 4, boxH, C.indigo);
      setFont('normal', 10, C.bodyText);
      let by = y + 14;
      boxLines.forEach((line: string) => { pdf.text(line, bodyX + 14, by); by += 14; });
      y += boxH + 8;
      return;
    }

    // Paragraphs
    const paragraphs = Array.isArray(section.paragraphs) ? section.paragraphs : [];
    paragraphs.forEach((para, pi) => {
      const safe = normalizePdfText(para);
      if (!safe) return;
      pdf.setFontSize(10.5);
      const lines: string[] = pdf.splitTextToSize(safe, bodyW);
      ensureSpace(lines.length * 15 + 5);
      setFont('normal', 10.5, C.bodyText);
      lines.forEach((line: string) => { pdf.text(line, bodyX, y); y += 15; });
      y += (pi < paragraphs.length - 1 ? 5 : 4);
    });

    // Bullets — em-dash in accent color, text in body color
    const bullets = Array.isArray(section.bullets) ? section.bullets : [];
    const bulletW = bodyW - 16;
    bullets.forEach((bullet, bi) => {
      const norm = normalizeBullet(bullet);
      if (!norm) return;
      pdf.setFontSize(10.5);
      const lines: string[] = pdf.splitTextToSize(norm, bulletW);
      ensureSpace(lines.length * 15 + 3);
      setFont('normal', 10.5, C.indigo);
      pdf.text('\u2013', bodyX + 2, y);
      setFont('normal', 10.5, C.bodyText);
      lines.forEach((line: string) => { pdf.text(line, bodyX + 14, y); y += 15; });
      if (bi < bullets.length - 1) y += 2;
    });

    if (paragraphs.length + bullets.length > 0) y += 2;
  });

  // ── Post-pass: running header + footer ───────────────────────────────────

  const totalPages = pdf.getNumberOfPages();
  const runningLabel = normalizePdfText(
    document.subtitle
      ? `${document.title || ''}  |  ${document.subtitle.toUpperCase()}`
      : document.title || '',
  );
  const footerNote = normalizePdfText(document.footerNote ?? '');

  for (let p = 1; p <= totalPages; p++) {
    pdf.setPage(p);

    if (p > 1) {
      pdf.setDrawColor(C.borderLight[0], C.borderLight[1], C.borderLight[2]);
      pdf.setLineWidth(0.5);
      pdf.line(mL, mT - 10, pageWidth - mR, mT - 10);
      setFont('normal', 7.5, C.label);
      pdf.text(runningLabel, mL, mT - 16);
    }

    const fy = pageHeight - 18;
    setFont('normal', 7.5, C.label);
    if (footerNote) pdf.text(footerNote, mL, fy);
    pdf.text(`Page ${p} of ${totalPages}`, pageWidth - mR, fy, { align: 'right' });
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
