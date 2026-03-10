export type PdfSection = {
  heading: string;
  /** 1 = major group header  2 = subsection (default) */
  level?: 1 | 2;
  paragraphs?: string[];
  bullets?: string[];
  /** When true, bullets are rendered as a numbered list (1. 2. 3.) instead of em-dash list. */
  numberedBullets?: boolean;
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
      // Consistent breathing room at the top of every new page (after running header)
      y = mT + runHdrH + 12;
    }
  };

  /** Estimate wrapped line count for a string at a given font size and max width. */
  const lineCount = (text: string, maxW: number, fz: number): number => {
    pdf.setFontSize(fz);
    const lines: string[] = pdf.splitTextToSize(normalizePdfText(text), maxW);
    return Math.max(1, lines.length);
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

  // Subtitle: comparison/document name — shown in muted white-blue, NOT uppercased
  const subtitleSafe = normalizePdfText(document.subtitle ?? '');
  if (subtitleSafe) {
    const subLines: string[] = pdf.splitTextToSize(subtitleSafe, colW - 10);
    setFont('normal', 9, [185, 198, 220] as [number, number, number]);
    pdf.text(subLines[0] ?? subtitleSafe, mL, 43);
  }

  // Metadata: date + truncated ID
  const generatedAt = document.generatedAt || new Date();
  const rawId = asText(document.comparisonId);
  // Truncate UUID-style IDs to first 8 hex chars for clean display
  const shortId = rawId
    ? rawId.replace(/^[a-z_-]+/i, '').replace(/^[-_]/, '').slice(0, 8) || rawId.slice(0, 12)
    : '';
  const metaText = normalizePdfText(
    `Generated: ${formatGeneratedAt(generatedAt)}` +
    (shortId ? `  \u00B7  ID: ${shortId}` : ''),
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

    // panelH accounts for: 14 initial + 46 metrics row + 14 hLine gap (now 14) + 24 label gap
    // (now 18) + 18 context lead = 116 fixed + dynamic context/driver rows + 14 bottom pad.
    const panelH = 14 + 46 + 14 + 24 + 18 + ctxH + (driversArr.length > 0 ? 8 + driversH : 0) + 14;

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
    y += 14;

    // Decision status — label sits on its own line; accent bar is beside the status text only
    setFont('normal', 7, C.label);
    pdf.text('DECISION STATUS', innerX, y);
    y += 18;  // generous gap below the label before the status bar/text

    // Draw accent bar anchored to the status text baseline so it never overlaps the label
    fillRect(innerX, y - 14, 4, 18, dp.fitColor);
    setFont('bold', 12, dp.fitColor);
    pdf.text(normalizePdfText(dp.decisionStatus), innerX + 10, y);
    y += 10;

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

    y = py + panelH + 28;  // extra breathing room between panel and first section
  }

  // ── Sections ──────────────────────────────────────────────────────────────

  const sections = Array.isArray(document.sections) ? document.sections : [];

  sections.forEach((section, idx) => {
    const level = section.level ?? 2;
    const isL1 = level === 1;

    if (section.breakBefore) {
      ensureSpace(9999, true);
    } else if (isL1 && idx > 0) {
      // ── Orphan guard: divider (22pt) + band (26pt) + caption (14pt est.) +
      //    minimum 2 lines of content (30pt) must all fit together.
      const captionH = section.caption ? lineCount(section.caption, colW - 16, 8) * 12 + 3 : 0;
      const minContentH = (section.bullets?.length ?? 0) + (section.paragraphs?.length ?? 0) > 0 ? 32 : 0;
      ensureSpace(22 + 26 + captionH + minContentH);
      y += 8;
      hLine(mL, pageWidth - mR, y, C.divL1);
      y += 14;
    } else if (!isL1 && idx > 0) {
      // ── Orphan guard for L2: must keep heading + content together.
      // For short bullet lists (≤6) we pre-compute the FULL list height so we
      // page-break before the heading, not after it.
      const h2safe = normalizePdfText(section.heading || '');
      const h2HeadH = lineCount(h2safe, colW - 8, 11) * 15 + 2;
      const captionH2 = section.caption ? lineCount(section.caption, colW - 12, 8) * 12 + 2 : 0;
      const bulletsArr = Array.isArray(section.bullets) ? section.bullets : [];
      const parasArr = Array.isArray(section.paragraphs) ? section.paragraphs : [];

      let minContentH = 0;
      if (bulletsArr.length > 0 && bulletsArr.length <= 6) {
        // Reserve height for the ENTIRE short bullet list
        pdf.setFontSize(10.5);
        minContentH = bulletsArr.reduce((acc, b) => {
          const norm = normalizeBullet(b);
          if (!norm) return acc;
          const ls: string[] = pdf.splitTextToSize(norm, colW - 16 - 12);
          return acc + ls.length * 15 + 2;
        }, 0);
      } else if (section.callout && parasArr.length > 0) {
        // Callout box: reserve enough for heading + first chunk of the box
        pdf.setFontSize(10);
        const boxW = colW - (isL1 ? 16 : 12) - 22;
        const boxLines: string[] = pdf.splitTextToSize(normalizePdfText(parasArr.join(' ')), boxW);
        minContentH = Math.min(boxLines.length, 6) * 14 + 24;
      } else if (parasArr.length > 0) {
        // Paragraphs: keep at least 2 wrapped lines with the heading
        pdf.setFontSize(10.5);
        const pLines: string[] = pdf.splitTextToSize(normalizePdfText(parasArr[0]), colW - 12);
        minContentH = Math.min(pLines.length, 3) * 15 + 5;
      } else if (bulletsArr.length > 6) {
        minContentH = 34;  // at least 2 bullets from a long list
      }

      ensureSpace(16 + h2HeadH + captionH2 + minContentH);
      y += 6;
      hLine(mL + 4, pageWidth - mR, y, C.divL2);
      y += 10;
    }

    // Level 1 heading — shaded band
    if (isL1) {
      const hUpper = normalizePdfText(
        (section.heading || `Section ${idx + 1}`).toUpperCase(),
      );
      // bandY is anchored at current y
      const bandH = 22;
      fillRect(mL, y, colW, bandH, C.panelBg);
      fillRect(mL, y, 4, bandH, C.indigo);
      setFont('bold', 10.5, C.indigoDark);
      // Text baseline sits 14pt into the 22pt band
      pdf.text(hUpper, mL + 12, y + 14);
      y += bandH + 2;

      if (section.caption) {
        emit({ text: section.caption, x: mL + 12, maxW: colW - 16, fz: 8, wt: 'italic', rgb: C.label, lh: 12, gapAfter: 3 });
      }
      if (!section.paragraphs?.length && !section.bullets?.length) return;
    } else {
      // Level 2 heading
      const h2safe = normalizePdfText(section.heading || `Section ${idx + 1}`);
      pdf.setFontSize(11);
      const h2lines: string[] = pdf.splitTextToSize(h2safe, colW - 8);
      // No separate ensureSpace here — the orphan guard above already reserved space
      setFont('bold', 11, C.indigoDeep);
      h2lines.forEach((line: string) => { pdf.text(line, mL + 4, y); y += 15; });
      y += 2;

      if (section.caption) {
        emit({ text: section.caption, x: mL + 4, maxW: colW - 12, fz: 8, wt: 'italic', rgb: C.label, lh: 12, gapAfter: 2 });
      }
    }

    const bodyX = isL1 ? mL + 12 : mL + 8;
    const bodyW = colW - (isL1 ? 16 : 12);

    // Callout box — always atomic: compute ensureSpace first, then capture y
    if (section.callout && section.paragraphs?.length) {
      const safe = normalizePdfText(section.paragraphs.join(' '));
      pdf.setFontSize(10);
      const boxLines: string[] = pdf.splitTextToSize(safe, bodyW - 22);
      const boxH = boxLines.length * 14 + 24;  // 12pt top pad + 12pt bottom pad
      // Ensure the ENTIRE box fits; if too tall for remaining space, break to new page
      const availH = contentBottom - y;
      if (boxH > availH) {
        ensureSpace(9999, true);
      }
      // Capture y after potential page break so box and text are co-located
      const boxTop = y;
      fillRect(bodyX, boxTop, bodyW, boxH, C.calloutBg);
      strokeRect(bodyX, boxTop, bodyW, boxH, C.indigo, 0.75);
      fillRect(bodyX, boxTop, 4, boxH, C.indigo);
      setFont('normal', 10, C.bodyText);
      let by = boxTop + 14;
      boxLines.forEach((line: string) => { pdf.text(line, bodyX + 14, by); by += 14; });
      y = boxTop + boxH + 10;
      return;
    }

    // Paragraphs
    const paragraphs = Array.isArray(section.paragraphs) ? section.paragraphs : [];
    paragraphs.forEach((para, pi) => {
      const safe = normalizePdfText(para);
      if (!safe) return;
      pdf.setFontSize(10.5);
      const lines: string[] = pdf.splitTextToSize(safe, bodyW);
      const lineH = 15;
      // Widow prevention: never strand a single orphaned line at the bottom of a page.
      // If only 1 line fits in the remaining space but the paragraph wraps to 2+,
      // move the whole paragraph to the next page.
      const spaceLeft = contentBottom - y;
      const linesOnPage = Math.floor(spaceLeft / lineH);
      if (lines.length > 1 && linesOnPage <= 1) {
        ensureSpace(9999, true);
      } else {
        ensureSpace(Math.min(lines.length, 2) * lineH + 5);
      }
      setFont('normal', 10.5, C.bodyText);
      lines.forEach((line: string) => { pdf.text(line, bodyX, y); y += lineH; });
      y += (pi < paragraphs.length - 1 ? 5 : 4);
    });

    // Bullets — em-dash or numbered list, accent color prefix, text in body color
    const bullets = Array.isArray(section.bullets) ? section.bullets : [];
    const useNumbered = section.numberedBullets === true;
    const bulletW = bodyW - (useNumbered ? 20 : 16);
    if (bullets.length > 0) {
      // Pre-compute per-bullet heights so we can decide atomicity up-front.
      pdf.setFontSize(10.5);
      const bulletHeights = bullets.map((b) => {
        const norm = normalizeBullet(b);
        if (!norm) return 0;
        const ls: string[] = pdf.splitTextToSize(norm, bulletW);
        return ls.length * 15 + 2;
      });
      const totalBulletH = bulletHeights.reduce((a, c) => a + c, 0);

      if (bullets.length <= 6) {
        // Short list — keep entirely on one page.
        ensureSpace(totalBulletH);
      } else {
        // Longer list — keep at least the first 2 bullets with whatever heading preceded.
        const twoItemH = bulletHeights.slice(0, 2).reduce((a, c) => a + c, 0);
        ensureSpace(twoItemH);
      }

      bullets.forEach((bullet, bi) => {
        const norm = normalizeBullet(bullet);
        if (!norm) return;
        pdf.setFontSize(10.5);
        const lines: string[] = pdf.splitTextToSize(norm, bulletW);
        const itemH = lines.length * 15 + 2;
        // For long lists allow mid-list page breaks, but keep each item's
        // wrapped lines together (never split one bullet entry across pages).
        if (bullets.length > 6) ensureSpace(itemH);
        if (useNumbered) {
          // Numbered list: "1." in accent color
          setFont('bold', 10.5, C.indigo);
          pdf.text(`${bi + 1}.`, bodyX + 2, y);
          setFont('normal', 10.5, C.bodyText);
          lines.forEach((line: string) => { pdf.text(line, bodyX + 18, y); y += 15; });
        } else {
          setFont('normal', 10.5, C.indigo);
          pdf.text('\u2013', bodyX + 2, y);
          setFont('normal', 10.5, C.bodyText);
          lines.forEach((line: string) => { pdf.text(line, bodyX + 14, y); y += 15; });
        }
        y += 2;
      });
    }

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
