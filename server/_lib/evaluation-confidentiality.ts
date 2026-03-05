type LeakType = 'canary_token' | 'confidential_substring' | 'confidential_token';

export type CounterpartyLeakGuard = {
  hasForbiddenContent: boolean;
  canaryTokens: string[];
  phraseCandidates: string[];
  sensitiveTokens: string[];
};

export type CounterpartyLeakMatch = {
  leakType: LeakType;
  leakSample: string;
};

export type EvaluationSection = {
  key: string;
  heading: string;
  bullets: string[];
};

export type SectionHealingWarnings = {
  confidentiality_section_redacted: string[];
  confidentiality_section_regenerated: string[];
  retries_used: Record<string, number>;
};

export type HealEvaluationReportSectionsResult = {
  report: Record<string, unknown>;
  warnings: SectionHealingWarnings;
};

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function asLower(value: unknown) {
  return asText(value).toLowerCase();
}

function normalizeForLeakScan(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCanaryTokens(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  const unique = new Set<string>();
  value.forEach((entry) => {
    const token = asLower(entry);
    if (!token) {
      return;
    }
    unique.add(token);
  });
  return [...unique].slice(0, 120);
}

function buildPhraseCandidates(counterpartyConfidentialText: string, sharedText: string) {
  const forbiddenWords = normalizeForLeakScan(counterpartyConfidentialText)
    .split(/\s+/g)
    .filter(Boolean);
  const sharedNormalized = normalizeForLeakScan(sharedText);
  const candidates = new Set<string>();

  for (let index = 0; index + 4 < forbiddenWords.length && candidates.size < 320; index += 2) {
    const phrase = forbiddenWords.slice(index, index + 5).join(' ').trim();
    if (!phrase || phrase.length < 20) {
      continue;
    }
    if (sharedNormalized.includes(phrase)) {
      continue;
    }
    candidates.add(phrase);
  }

  return [...candidates].slice(0, 320);
}

function collectSensitiveTokens(counterpartyConfidentialText: string, sharedText: string) {
  const forbiddenLower = String(counterpartyConfidentialText || '').toLowerCase();
  const sharedLower = String(sharedText || '').toLowerCase();
  const tokenSet = new Set<string>();

  const emails = forbiddenLower.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || [];
  const ids = forbiddenLower.match(/\b[a-z][a-z0-9_-]{6,}\d[a-z0-9_-]*\b/g) || [];
  const numbers = forbiddenLower.match(/\b\d{4,}\b/g) || [];

  [...emails, ...ids, ...numbers]
    .map((entry) => String(entry || '').trim())
    .filter((entry) => entry.length >= 4)
    .forEach((entry) => {
      if (sharedLower.includes(entry)) {
        return;
      }
      tokenSet.add(entry);
    });

  return [...tokenSet].slice(0, 320);
}

function normalizeSection(section: unknown, index: number): EvaluationSection {
  if (!section || typeof section !== 'object' || Array.isArray(section)) {
    return {
      key: `section_${index + 1}`,
      heading: `Section ${index + 1}`,
      bullets: [],
    };
  }
  const row = section as Record<string, unknown>;
  const key = asText(row.key) || `section_${index + 1}`;
  const heading = asText(row.heading) || key;
  const bullets = Array.isArray(row.bullets)
    ? row.bullets.map((entry) => asText(entry)).filter(Boolean)
    : [];
  return {
    key,
    heading,
    bullets,
  };
}

function sectionToText(section: EvaluationSection) {
  const parts = [section.heading, ...section.bullets].map((entry) => asText(entry)).filter(Boolean);
  return parts.join('\n');
}

function dedupe<T>(value: T[]) {
  return [...new Set(value)];
}

function buildFallbackLine(includeGuidance: boolean) {
  if (includeGuidance) {
    return "This section can't be shown due to confidentiality. You can request this in the shared report / ask the counterparty to share it.";
  }
  return "This section can't be shown due to confidentiality.";
}

function sanitizeSummaryTextArray(value: unknown, guard: CounterpartyLeakGuard, fallback: string) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => asText(entry))
    .filter(Boolean)
    .map((entry) => (detectCounterpartyLeak(entry, guard) ? fallback : entry));
}

function sanitizeSummaryObjectArray(value: unknown, guard: CounterpartyLeakGuard, fallback: string) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return entry;
    }
    const row = { ...(entry as Record<string, unknown>) };
    const rowText = asText(row.text);
    if (!rowText) {
      return row;
    }
    if (!detectCounterpartyLeak(rowText, guard)) {
      return row;
    }
    row.text = fallback;
    return row;
  });
}

export function buildCounterpartyLeakGuard(params: {
  sharedText: string;
  counterpartyConfidentialText?: string;
  counterpartyCanaryTokens?: string[];
}): CounterpartyLeakGuard {
  const sharedText = String(params.sharedText || '');
  const forbiddenText = String(params.counterpartyConfidentialText || '');
  const canaryTokens = normalizeCanaryTokens(params.counterpartyCanaryTokens);
  const phraseCandidates = buildPhraseCandidates(forbiddenText, sharedText);
  const sensitiveTokens = collectSensitiveTokens(forbiddenText, sharedText);
  return {
    hasForbiddenContent: Boolean(
      forbiddenText.trim().length > 0 || canaryTokens.length > 0 || phraseCandidates.length > 0 || sensitiveTokens.length > 0,
    ),
    canaryTokens,
    phraseCandidates,
    sensitiveTokens,
  };
}

export function detectCounterpartyLeak(text: string, guard: CounterpartyLeakGuard): CounterpartyLeakMatch | null {
  if (!guard.hasForbiddenContent) {
    return null;
  }
  const rawText = String(text || '');
  const lowerText = rawText.toLowerCase();
  const normalizedText = normalizeForLeakScan(rawText);
  if (!normalizedText && !lowerText) {
    return null;
  }

  const leakedCanary = guard.canaryTokens.find((token) => lowerText.includes(token));
  if (leakedCanary) {
    return {
      leakType: 'canary_token',
      leakSample: leakedCanary.slice(0, 120),
    };
  }

  const leakedPhrase = guard.phraseCandidates.find((phrase) => normalizedText.includes(phrase));
  if (leakedPhrase) {
    return {
      leakType: 'confidential_substring',
      leakSample: leakedPhrase.slice(0, 120),
    };
  }

  const leakedToken = guard.sensitiveTokens.find((token) => lowerText.includes(token));
  if (leakedToken) {
    return {
      leakType: 'confidential_token',
      leakSample: leakedToken.slice(0, 120),
    };
  }

  return null;
}

export function parseBulletsFromModelText(text: string) {
  const normalized = String(text || '').replace(/\r/g, '\n').trim();
  if (!normalized) {
    return [] as string[];
  }

  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*]\s+/, '').replace(/^\d+[.)]\s+/, '').trim())
    .filter(Boolean);

  if (lines.length >= 2) {
    return dedupe(lines).slice(0, 8);
  }

  const sentenceLike = normalized
    .split(/(?<=[.!?])\s+/g)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 6);
  return dedupe(sentenceLike);
}

export function isCounterpartyConfidentialIntent(text: string) {
  const normalized = asLower(text);
  if (!normalized) {
    return false;
  }
  const mentionsCounterparty =
    normalized.includes('counterparty') ||
    normalized.includes('other side') ||
    normalized.includes('other party') ||
    normalized.includes('their confidential') ||
    normalized.includes('their budget') ||
    normalized.includes('their spend');
  if (!mentionsCounterparty) {
    return false;
  }

  return /(budget|spend|willing|price|pricing|margin|bottom line|private|confidential|secret)/.test(normalized);
}

export async function healEvaluationReportSections(params: {
  report: unknown;
  guard: CounterpartyLeakGuard;
  regenerateSection: (input: {
    section: EvaluationSection;
    sectionIndex: number;
    attempt: number;
    strictMode: boolean;
    originalSectionText: string;
  }) => Promise<string>;
  maxRetries?: number;
}): Promise<HealEvaluationReportSectionsResult> {
  const report =
    params.report && typeof params.report === 'object' && !Array.isArray(params.report)
      ? ({ ...(params.report as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  const maxRetries = Number.isFinite(Number(params.maxRetries))
    ? Math.max(1, Math.floor(Number(params.maxRetries)))
    : 2;
  const warnings: SectionHealingWarnings = {
    confidentiality_section_redacted: [],
    confidentiality_section_regenerated: [],
    retries_used: {},
  };

  if (!params.guard.hasForbiddenContent) {
    return {
      report,
      warnings,
    };
  }

  const originalSections = Array.isArray(report.sections) ? report.sections : [];
  if (!originalSections.length) {
    return {
      report,
      warnings,
    };
  }

  const nextSections = originalSections.map((entry, index) => normalizeSection(entry, index));
  let changed = false;

  for (let index = 0; index < nextSections.length; index += 1) {
    const section = nextSections[index];
    const sectionName = section.key || `section_${index + 1}`;
    const originalSectionText = sectionToText(section);
    if (!detectCounterpartyLeak(originalSectionText, params.guard)) {
      continue;
    }

    let healed = false;
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      warnings.retries_used[sectionName] = attempt;
      let regeneratedText = '';
      try {
        regeneratedText = await params.regenerateSection({
          section,
          sectionIndex: index,
          attempt,
          strictMode: attempt > 1,
          originalSectionText,
        });
      } catch {
        regeneratedText = '';
      }
      const regeneratedBullets = parseBulletsFromModelText(regeneratedText);
      if (!regeneratedBullets.length) {
        continue;
      }
      const candidateSection: EvaluationSection = {
        ...section,
        bullets: regeneratedBullets,
      };
      const candidateText = sectionToText(candidateSection);
      if (detectCounterpartyLeak(candidateText, params.guard)) {
        continue;
      }
      nextSections[index] = candidateSection;
      warnings.confidentiality_section_regenerated.push(sectionName);
      changed = true;
      healed = true;
      break;
    }

    if (healed) {
      continue;
    }

    const includeGuidance = isCounterpartyConfidentialIntent(originalSectionText);
    nextSections[index] = {
      ...section,
      bullets: [buildFallbackLine(includeGuidance)],
    };
    warnings.confidentiality_section_redacted.push(sectionName);
    changed = true;
  }

  if (changed) {
    report.sections = nextSections.map((section) => ({
      key: section.key,
      heading: section.heading,
      bullets: section.bullets,
    }));
  }

  const fallbackSummary = buildFallbackLine(false);
  if (detectCounterpartyLeak(asText(report.executive_summary), params.guard)) {
    report.executive_summary = fallbackSummary;
  }

  const reportSummary =
    report.summary && typeof report.summary === 'object' && !Array.isArray(report.summary)
      ? ({ ...(report.summary as Record<string, unknown>) } as Record<string, unknown>)
      : null;
  if (reportSummary) {
    reportSummary.top_fit_reasons = sanitizeSummaryObjectArray(
      reportSummary.top_fit_reasons,
      params.guard,
      fallbackSummary,
    );
    reportSummary.top_blockers = sanitizeSummaryObjectArray(
      reportSummary.top_blockers,
      params.guard,
      fallbackSummary,
    );
    reportSummary.next_actions = sanitizeSummaryTextArray(
      reportSummary.next_actions,
      params.guard,
      fallbackSummary,
    );
    report.summary = reportSummary;
  }

  warnings.confidentiality_section_redacted = dedupe(warnings.confidentiality_section_redacted);
  warnings.confidentiality_section_regenerated = dedupe(warnings.confidentiality_section_regenerated);

  return {
    report,
    warnings,
  };
}
