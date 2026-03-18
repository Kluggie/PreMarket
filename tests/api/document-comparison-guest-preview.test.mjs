import assert from 'node:assert/strict';
import test from 'node:test';
import guestCoachHandler from '../../server/routes/public/document-comparisons/coach.ts';
import guestCompanyBriefHandler from '../../server/routes/public/document-comparisons/company-brief.ts';
import guestEvaluateHandler from '../../server/routes/public/document-comparisons/evaluate.ts';
import {
  __resetGuestPreviewRateLimitsForTest,
  GUEST_AI_ASSISTANCE_IP_LIMIT,
  GUEST_AI_ASSISTANCE_SESSION_LIMIT,
} from '../../server/routes/public/document-comparisons/_guest.ts';
import { ensureTestEnv } from '../helpers/auth.mjs';
import { createMockReq, createMockRes } from '../helpers/httpMock.mjs';

ensureTestEnv();

function buildGuestPreviewBody(overrides = {}) {
  return {
    title: 'Guest preview comparison',
    guestDraftId: 'guest_draft_preview_test',
    guestSessionId: 'guest_session_preview_test',
    doc_a_text:
      'Confidential requirements include pricing controls, staffing protections, and delivery guardrails that must remain private.',
    doc_b_text:
      'Shared scope covers onboarding, SLAs, implementation milestones, and escalation responsibilities for both parties.',
    doc_a_html:
      '<p>Confidential requirements include pricing controls, staffing protections, and delivery guardrails that must remain private.</p>',
    doc_b_html:
      '<p>Shared scope covers onboarding, SLAs, implementation milestones, and escalation responsibilities for both parties.</p>',
    ...overrides,
  };
}

async function callRoute(handler, { url, method = 'POST', headers = {}, body = {} }) {
  const req = createMockReq({
    method,
    url,
    headers,
    body,
  });
  const res = createMockRes();
  await handler(req, res);
  return res;
}

test('guest coach succeeds without auth and returns preview-safe suggestions', async () => {
  __resetGuestPreviewRateLimitsForTest();
  const originalVertexMock = process.env.VERTEX_MOCK;
  process.env.VERTEX_MOCK = '1';

  try {
    const res = await callRoute(guestCoachHandler, {
      url: '/api/public/document-comparisons/coach',
      headers: { 'x-real-ip': '198.51.100.10' },
      body: {
        ...buildGuestPreviewBody(),
        mode: 'full',
        intent: 'general',
        action: 'general',
      },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody()?.comparison_id, 'guest_draft_preview_test');
    assert.equal(typeof res.jsonBody()?.coach?.summary?.overall, 'string');
    assert.ok(Array.isArray(res.jsonBody()?.coach?.suggestions));
  } finally {
    __resetGuestPreviewRateLimitsForTest();
    if (originalVertexMock === undefined) {
      delete process.env.VERTEX_MOCK;
    } else {
      process.env.VERTEX_MOCK = originalVertexMock;
    }
  }
});

test('guest company brief succeeds without auth and returns browser-only brief content', async () => {
  __resetGuestPreviewRateLimitsForTest();
  const originalResearchOverride = globalThis.__PREMARKET_TEST_COMPANY_BRIEF_RESEARCH__;
  const originalVertexOverride = globalThis.__PREMARKET_TEST_COMPANY_BRIEF_VERTEX_CALL__;

  globalThis.__PREMARKET_TEST_COMPANY_BRIEF_RESEARCH__ = async () => ({
    queries: ['acme industries risk negotiation'],
    sources: [
      {
        title: 'Acme Overview',
        url: 'https://example.com/acme-overview',
        snippet: 'Acme overview snippet.',
      },
      {
        title: 'Acme Security',
        url: 'https://example.com/acme-security',
        snippet: 'Acme security snippet.',
      },
      {
        title: 'Acme Customers',
        url: 'https://example.com/acme-customers',
        snippet: 'Acme customers snippet.',
      },
    ],
  });
  globalThis.__PREMARKET_TEST_COMPANY_BRIEF_VERTEX_CALL__ = async () => ({
    model: 'company-brief-test-model',
    text: '',
  });

  try {
    const res = await callRoute(guestCompanyBriefHandler, {
      url: '/api/public/document-comparisons/company-brief',
      headers: { 'x-real-ip': '198.51.100.11' },
      body: {
        ...buildGuestPreviewBody({
          guestDraftId: 'guest_draft_company_brief',
          guestSessionId: 'guest_session_company_brief',
        }),
        companyName: 'Acme Industries',
        companyWebsite: 'https://acme.example',
        lens: 'risk_negotiation',
      },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody()?.comparison_id, 'guest_draft_company_brief');
    assert.equal(res.jsonBody()?.company_brief?.company_name, 'Acme Industries');
    assert.ok(
      String(res.jsonBody()?.company_brief?.content || '').includes('Acme Industries'),
      'expected company brief content to mention the company name',
    );
    assert.equal(Array.isArray(res.jsonBody()?.company_brief?.sources), true);
    assert.equal(res.jsonBody()?.company_brief?.sources?.length, 3);
  } finally {
    __resetGuestPreviewRateLimitsForTest();
    if (originalResearchOverride === undefined) {
      delete globalThis.__PREMARKET_TEST_COMPANY_BRIEF_RESEARCH__;
    } else {
      globalThis.__PREMARKET_TEST_COMPANY_BRIEF_RESEARCH__ = originalResearchOverride;
    }
    if (originalVertexOverride === undefined) {
      delete globalThis.__PREMARKET_TEST_COMPANY_BRIEF_VERTEX_CALL__;
    } else {
      globalThis.__PREMARKET_TEST_COMPANY_BRIEF_VERTEX_CALL__ = originalVertexOverride;
    }
  }
});

test('guest evaluation succeeds without auth, uses guest draft id, and returns preview report data', async () => {
  __resetGuestPreviewRateLimitsForTest();
  const originalEvaluator = globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__;

  globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__ = async () => ({
    evaluation_provider: 'vertex',
    evaluation_model: 'guest-preview-test-model',
    recommendation: 'Medium',
    summary: 'Shared scope is workable with a few open issues.',
    report: {
      report_format: 'v2',
      fit_level: 'medium',
      confidence_0_1: 0.71,
      why: ['Shared scope aligns with the implementation milestones in the confidential package.'],
      missing: ['Clarify the indemnity cap before sending the package.'],
      redactions: [],
      summary: {
        fit_level: 'medium',
        top_fit_reasons: [{ text: 'Implementation responsibilities align.' }],
        top_blockers: [{ text: 'Indemnity cap is still unresolved.' }],
        next_actions: ['Clarify the indemnity cap before re-running.'],
      },
      sections: [],
      recommendation: 'Medium',
    },
  });

  try {
    const res = await callRoute(guestEvaluateHandler, {
      url: '/api/public/document-comparisons/evaluate',
      headers: { 'x-real-ip': '198.51.100.12' },
      body: buildGuestPreviewBody({
        guestDraftId: 'guest_draft_eval_test',
        guestSessionId: 'guest_session_eval_test',
      }),
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody()?.comparison?.id, 'guest_draft_eval_test');
    assert.equal(res.jsonBody()?.comparison?.status, 'evaluated');
    assert.equal(res.jsonBody()?.evaluation_result?.recommendation, 'Medium');
    assert.equal(Array.isArray(res.jsonBody()?.evaluation?.why), true);
    assert.equal(res.jsonBody()?.evaluation_input_trace?.source, 'guest_preview');
  } finally {
    __resetGuestPreviewRateLimitsForTest();
    if (originalEvaluator === undefined) {
      delete globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__;
    } else {
      globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__ = originalEvaluator;
    }
  }
});

test('guest evaluation enforces one mediation run per guest draft', async () => {
  __resetGuestPreviewRateLimitsForTest();
  const originalEvaluator = globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__;

  globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__ = async () => ({
    evaluation_provider: 'vertex',
    evaluation_model: 'guest-preview-test-model',
    recommendation: 'Low',
    report: {
      report_format: 'v2',
      fit_level: 'low',
      confidence_0_1: 0.31,
      why: ['This is a limited guest preview run.'],
      missing: ['Resolve scope issues.'],
      redactions: [],
      summary: {
        fit_level: 'low',
        top_fit_reasons: [{ text: 'Initial preview only.' }],
        top_blockers: [{ text: 'Scope issues remain.' }],
        next_actions: ['Sign in for another run.'],
      },
      sections: [],
      recommendation: 'Low',
    },
  });

  try {
    const requestBody = buildGuestPreviewBody({
      guestDraftId: 'guest_draft_eval_limit_test',
      guestSessionId: 'guest_session_eval_limit_test',
    });

    const firstRes = await callRoute(guestEvaluateHandler, {
      url: '/api/public/document-comparisons/evaluate',
      headers: { 'x-real-ip': '198.51.100.13' },
      body: requestBody,
    });
    assert.equal(firstRes.statusCode, 200);

    const secondRes = await callRoute(guestEvaluateHandler, {
      url: '/api/public/document-comparisons/evaluate',
      headers: { 'x-real-ip': '198.51.100.13' },
      body: requestBody,
    });
    assert.equal(secondRes.statusCode, 429);
    assert.equal(secondRes.jsonBody()?.error?.code, 'guest_ai_mediation_limit_reached');
    assert.match(
      String(secondRes.jsonBody()?.error?.message || ''),
      /sign in to continue with more ai runs/i,
    );
  } finally {
    __resetGuestPreviewRateLimitsForTest();
    if (originalEvaluator === undefined) {
      delete globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__;
    } else {
      globalThis.__PREMARKET_TEST_DOCUMENT_COMPARISON_EVALUATOR__ = originalEvaluator;
    }
  }
});

test('guest coach enforces the per-session assistance limit', async () => {
  __resetGuestPreviewRateLimitsForTest();
  const originalVertexMock = process.env.VERTEX_MOCK;
  process.env.VERTEX_MOCK = '1';

  try {
    for (let attempt = 0; attempt < GUEST_AI_ASSISTANCE_SESSION_LIMIT; attempt += 1) {
      const okRes = await callRoute(guestCoachHandler, {
        url: '/api/public/document-comparisons/coach',
        headers: { 'x-real-ip': '198.51.100.14' },
        body: buildGuestPreviewBody({
          guestDraftId: `guest_draft_assist_session_${attempt}`,
          guestSessionId: 'guest_session_same_limit',
          intent: 'general',
          action: 'general',
          mode: 'full',
        }),
      });
      assert.equal(okRes.statusCode, 200);
    }

    const limitedRes = await callRoute(guestCoachHandler, {
      url: '/api/public/document-comparisons/coach',
      headers: { 'x-real-ip': '198.51.100.14' },
      body: buildGuestPreviewBody({
        guestDraftId: 'guest_draft_assist_session_limited',
        guestSessionId: 'guest_session_same_limit',
        intent: 'general',
        action: 'general',
        mode: 'full',
      }),
    });

    assert.equal(limitedRes.statusCode, 429);
    assert.equal(limitedRes.jsonBody()?.error?.code, 'guest_ai_assistance_limit_reached');
  } finally {
    __resetGuestPreviewRateLimitsForTest();
    if (originalVertexMock === undefined) {
      delete process.env.VERTEX_MOCK;
    } else {
      process.env.VERTEX_MOCK = originalVertexMock;
    }
  }
});

test('guest assistance IP rate limit uses the trusted rightmost proxy IP, not the spoofable leftmost XFF value', async () => {
  __resetGuestPreviewRateLimitsForTest();
  const originalVertexMock = process.env.VERTEX_MOCK;
  process.env.VERTEX_MOCK = '1';

  try {
    for (let attempt = 0; attempt < GUEST_AI_ASSISTANCE_IP_LIMIT; attempt += 1) {
      const okRes = await callRoute(guestCoachHandler, {
        url: '/api/public/document-comparisons/coach',
        headers: {
          'x-forwarded-for': `spoofed-${attempt}, 203.0.113.40`,
        },
        body: buildGuestPreviewBody({
          guestDraftId: `guest_draft_ip_limit_${attempt}`,
          guestSessionId: `guest_session_ip_limit_${attempt}`,
          intent: 'general',
          action: 'general',
          mode: 'full',
        }),
      });
      assert.equal(okRes.statusCode, 200);
    }

    const limitedRes = await callRoute(guestCoachHandler, {
      url: '/api/public/document-comparisons/coach',
      headers: {
        'x-forwarded-for': 'attacker-controlled-value, 203.0.113.40',
      },
      body: buildGuestPreviewBody({
        guestDraftId: 'guest_draft_ip_limit_final',
        guestSessionId: 'guest_session_ip_limit_final',
        intent: 'general',
        action: 'general',
        mode: 'full',
      }),
    });

    assert.equal(limitedRes.statusCode, 429);
    assert.equal(limitedRes.jsonBody()?.error?.code, 'guest_ai_assistance_limit_reached');
  } finally {
    __resetGuestPreviewRateLimitsForTest();
    if (originalVertexMock === undefined) {
      delete process.env.VERTEX_MOCK;
    } else {
      process.env.VERTEX_MOCK = originalVertexMock;
    }
  }
});
