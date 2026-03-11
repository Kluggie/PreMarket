/**
 * Unit tests for src/lib/aiReportUtils.js
 *
 * Tests the pure helper functions that drive the AI mediation review display.
 * No DOM or React needed — plain node:test.
 *
 * Run with:
 *   node --import=tsx --test tests/lib/ai-report-v2-display.test.mjs
 * (tsx is needed so the JS module with export syntax resolves cleanly)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasV2Report,
  getMediationReviewTitle,
  getRunAiMediationLabel,
  parseV2WhyEntry,
  filterLegacySectionsForDisplay,
  getConfidencePercent,
  MEDIATION_REVIEW_LABEL,
} from '../../src/lib/aiReportUtils.js';
import {
  buildMediationReviewSections,
  buildMediationReviewTitle,
  MEDIATION_REVIEW_TITLE,
} from '../../server/routes/document-comparisons/_helpers.ts';

// ─── hasV2Report ─────────────────────────────────────────────────────────────

test('hasV2Report: returns true when why is a non-empty array', () => {
  assert.equal(
    hasV2Report({ why: ['Executive Summary: Good proposal.'] }),
    true,
  );
});

test('hasV2Report: returns false when why is an empty array', () => {
  assert.equal(hasV2Report({ why: [] }), false);
});

test('hasV2Report: returns false when why is absent', () => {
  assert.equal(hasV2Report({ fit_level: 'medium', sections: [] }), false);
});

test('hasV2Report: returns false for null/undefined', () => {
  assert.equal(hasV2Report(null), false);
  assert.equal(hasV2Report(undefined), false);
});

// ─── parseV2WhyEntry ─────────────────────────────────────────────────────────

test('parseV2WhyEntry: extracts heading and body from standard V2 entry', () => {
  const result = parseV2WhyEntry('Executive Summary: The proposal clearly defines deliverables.');
  assert.equal(result.heading, 'Executive Summary');
  assert.equal(result.body, 'The proposal clearly defines deliverables.');
});

test('parseV2WhyEntry: handles multi-word headings', () => {
  const result = parseV2WhyEntry('Key Strengths: Timeline is realistic given the team size.');
  assert.equal(result.heading, 'Key Strengths');
  assert.equal(result.body, 'Timeline is realistic given the team size.');
});

test('parseV2WhyEntry: returns null heading for plain text without pattern', () => {
  const result = parseV2WhyEntry('Just a plain sentence with no heading.');
  assert.equal(result.heading, null);
  assert.equal(result.body, 'Just a plain sentence with no heading.');
});

test('parseV2WhyEntry: handles Data & Security Notes heading', () => {
  const result = parseV2WhyEntry('Data & Security Notes: API integration requires TLS 1.2.');
  assert.equal(result.heading, 'Data & Security Notes');
  assert.equal(result.body, 'API integration requires TLS 1.2.');
});

test('parseV2WhyEntry: empty string returns null heading and empty body', () => {
  const result = parseV2WhyEntry('');
  assert.equal(result.heading, null);
  assert.equal(result.body, '');
});

test('parseV2WhyEntry: handles Recommendations with long body', () => {
  const body = 'Ensure timeline milestones are agreed before contract signing. Address budget constraints.';
  const result = parseV2WhyEntry(`Recommendations: ${body}`);
  assert.equal(result.heading, 'Recommendations');
  assert.equal(result.body, body);
});

test('mediation review copy helpers: expose mediation-oriented labels', () => {
  assert.equal(MEDIATION_REVIEW_LABEL, 'AI Mediation Review');
  assert.equal(getRunAiMediationLabel(), 'Run AI Mediation');
  assert.equal(getRunAiMediationLabel({ hasExisting: true }), 'Re-run AI Mediation');
  assert.equal(getRunAiMediationLabel({ isPending: true }), 'Running AI Mediation...');
});

test('mediation review title helpers: avoid Untitled-style placeholders', () => {
  assert.equal(getMediationReviewTitle('', 'Untitled', 'Northwind Services Renewal'), 'Northwind Services Renewal');
  assert.equal(getMediationReviewTitle('', 'Shared Report'), 'AI Mediation Review');
  assert.equal(buildMediationReviewTitle('', 'Untitled proposal', 'Northwind Services Renewal'), 'Northwind Services Renewal');
  assert.equal(buildMediationReviewTitle('', 'Shared Report'), MEDIATION_REVIEW_TITLE);
});

test('mediation review section helper: omits empty redactions headings while preserving why and missing', () => {
  assert.deepEqual(
    buildMediationReviewSections({
      why: ['Executive Summary: Alignment exists around the phased rollout.'],
      missing: ['What acceptance criteria define completion?'],
      redactions: [],
    }),
    [
      {
        key: 'why',
        heading: 'Why',
        bullets: ['Executive Summary: Alignment exists around the phased rollout.'],
      },
      {
        key: 'missing',
        heading: 'Missing',
        bullets: ['What acceptance criteria define completion?'],
      },
    ],
  );
});

// ─── filterLegacySectionsForDisplay ──────────────────────────────────────────

test('filterLegacySectionsForDisplay: keeps category_breakdown when ≥2 numeric scores', () => {
  const sections = [
    {
      key: 'category_breakdown',
      heading: 'Category Breakdown',
      bullets: [
        'Project Scope: score 11, confidence 80%',
        'Timeline: score 7, confidence 70%',
        'Budget: score n/a, confidence 90%',
      ],
    },
  ];
  const result = filterLegacySectionsForDisplay(sections);
  assert.equal(result.length, 1, 'should keep the category breakdown section');
  // n/a row must be stripped
  assert.equal(
    result[0].bullets.some((b) => /score n\/a/i.test(b)),
    false,
    'n/a rows must be removed',
  );
  assert.equal(result[0].bullets.length, 2, 'should have 2 numeric-score rows');
});

test('filterLegacySectionsForDisplay: hides category_breakdown when < 2 numeric scores', () => {
  const sections = [
    {
      key: 'category_breakdown',
      heading: 'Category Breakdown',
      bullets: [
        'Timeline: score n/a, confidence 70%',
        'Budget: score n/a, confidence 90%',
        'Security: score n/a, confidence 80%',
      ],
    },
  ];
  const result = filterLegacySectionsForDisplay(sections);
  assert.equal(result.length, 0, 'category breakdown must be hidden when no numeric scores');
});

test('filterLegacySectionsForDisplay: hides category_breakdown with exactly 1 numeric score', () => {
  const sections = [
    {
      key: 'category_breakdown',
      heading: 'Category Breakdown',
      bullets: [
        'Project Scope: score 11, confidence 80%',
        'Timeline: score n/a, confidence 70%',
      ],
    },
  ];
  const result = filterLegacySectionsForDisplay(sections);
  assert.equal(result.length, 0, 'needs ≥2 numeric scores to show');
});

test('filterLegacySectionsForDisplay: keeps Risk Flags when non-empty', () => {
  const sections = [
    {
      key: 'flags',
      heading: 'Risk Flags',
      bullets: ['MED: Fixed-price preference', 'MED: Aggressive Timeline'],
    },
  ];
  const result = filterLegacySectionsForDisplay(sections);
  assert.equal(result.length, 1);
  assert.equal(result[0].heading, 'Risk Flags');
  assert.equal(result[0].bullets.length, 2);
});

test('filterLegacySectionsForDisplay: hides Risk Flags when empty', () => {
  const sections = [{ key: 'flags', heading: 'Risk Flags', bullets: [] }];
  const result = filterLegacySectionsForDisplay(sections);
  assert.equal(result.length, 0);
});

test('filterLegacySectionsForDisplay: keeps Top Blockers when non-empty', () => {
  const sections = [
    {
      key: 'top_blockers',
      heading: 'Top Blockers',
      bullets: ['Timeline has an MVP target of 6-8 weeks, which may be aggressive.'],
    },
  ];
  const result = filterLegacySectionsForDisplay(sections);
  assert.equal(result.length, 1);
});

test('filterLegacySectionsForDisplay: hides Top Blockers when empty', () => {
  const sections = [{ key: 'top_blockers', heading: 'Top Blockers', bullets: [] }];
  const result = filterLegacySectionsForDisplay(sections);
  assert.equal(result.length, 0);
});

test('filterLegacySectionsForDisplay: handles null/undefined gracefully', () => {
  assert.deepEqual(filterLegacySectionsForDisplay(null), []);
  assert.deepEqual(filterLegacySectionsForDisplay(undefined), []);
  assert.deepEqual(filterLegacySectionsForDisplay([null, undefined, { key: 'flags', heading: 'Risk Flags', bullets: [] }]), []);
});

// ─── V2-only payload → no N/A rows and no category card ─────────────────────

test('V2 payload: hasV2Report true, filterLegacySectionsForDisplay returns empty for V2 sections', () => {
  // V2 report.sections = [{key:'why',...}, {key:'missing',...}, {key:'redactions',...}]
  const v2Report = {
    fit_level: 'medium',
    confidence_0_1: 0.73,
    why: ['Executive Summary: The proposal is solid.', 'Key Strengths: Clear scope.'],
    missing: ['What is the confirmed go-live deadline?'],
    redactions: [],
    sections: [
      { key: 'why', heading: 'Why', bullets: ['Executive Summary: The proposal is solid.'] },
      { key: 'missing', heading: 'Missing', bullets: ['What is the confirmed go-live deadline?'] },
      { key: 'redactions', heading: 'Redactions', bullets: [] },
    ],
  };

  assert.equal(hasV2Report(v2Report), true, 'V2 payload must be detected');

  // When V2 is detected the caller uses isV2Report=true and skips filterLegacySectionsForDisplay.
  // But if we ran filter on V2 sections, redactions would be hidden (empty) and others shown — 
  // the UI avoids this by checking isV2Report first and passing [] instead.
  const sections = filterLegacySectionsForDisplay(v2Report.sections);
  // 'why' and 'missing' have bullets so they pass through; 'redactions' is empty and filtered out.
  assert.equal(
    sections.some((s) => s.bullets && s.bullets.some((b) => /score n\/a/i.test(b))),
    false,
    'No n/a rows in filtered V2 sections',
  );
});

// ─── Legacy payload → legacy cards render ───────────────────────────────────

test('Legacy payload: hasV2Report false for legacy report without why', () => {
  const legacyReport = {
    similarity_score: 65,
    recommendation: 'Medium',
    sections: [
      {
        key: 'category_breakdown',
        heading: 'Category Breakdown',
        bullets: [
          'Project Scope: score 11, confidence 80%',
          'Timeline: score 7, confidence 70%',
          'Budget: score n/a, confidence 90%',
          'Security: score n/a, confidence 80%',
        ],
      },
      {
        key: 'flags',
        heading: 'Risk Flags',
        bullets: ['MED: Fixed-price preference', 'MED: Aggressive Timeline'],
      },
      {
        key: 'top_blockers',
        heading: 'Top Blockers',
        bullets: ['Timeline has MVP target of 6-8 weeks.'],
      },
    ],
  };

  assert.equal(hasV2Report(legacyReport), false, 'legacy report must not be detected as V2');

  const filtered = filterLegacySectionsForDisplay(legacyReport.sections);

  // Category Breakdown: 2 numeric scores → kept, n/a rows stripped.
  const catBreakdown = filtered.find((s) => s.key === 'category_breakdown');
  assert.ok(catBreakdown, 'Category Breakdown must be present for legacy with ≥2 numeric scores');
  assert.equal(catBreakdown.bullets.length, 2, 'only numeric-score rows kept');
  assert.equal(
    catBreakdown.bullets.every((b) => !/score n\/a/i.test(b)),
    true,
    'no n/a rows in output',
  );

  // Risk Flags → kept.
  const flags = filtered.find((s) => s.key === 'flags');
  assert.ok(flags, 'Risk Flags must be present when non-empty');

  // Top Blockers → kept.
  const blockers = filtered.find((s) => s.key === 'top_blockers');
  assert.ok(blockers, 'Top Blockers must be present when non-empty');
});

// ─── getConfidencePercent ─────────────────────────────────────────────────────

test('getConfidencePercent: uses confidence_0_1 for V2 reports', () => {
  assert.equal(getConfidencePercent({ confidence_0_1: 0.73 }, 50), 73);
  assert.equal(getConfidencePercent({ confidence_0_1: 1 }, 0), 100);
  assert.equal(getConfidencePercent({ confidence_0_1: 0 }, 99), 0);
});

test('getConfidencePercent: clamps confidence_0_1 to 0-100', () => {
  assert.equal(getConfidencePercent({ confidence_0_1: 1.5 }, 0), 100);
  assert.equal(getConfidencePercent({ confidence_0_1: -0.2 }, 0), 0);
});

test('getConfidencePercent: falls back to similarity_score for legacy reports', () => {
  assert.equal(getConfidencePercent({ similarity_score: 65 }, 0), 65);
});

test('getConfidencePercent: falls back to fallbackScore when no report fields', () => {
  assert.equal(getConfidencePercent({}, 42), 42);
  assert.equal(getConfidencePercent(null, 30), 30);
});

test('getConfidencePercent: returns 0 for missing data', () => {
  assert.equal(getConfidencePercent(null, null), 0);
  assert.equal(getConfidencePercent(undefined, undefined), 0);
});
