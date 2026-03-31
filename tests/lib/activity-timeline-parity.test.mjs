import assert from 'node:assert/strict';
import test from 'node:test';
import { buildActivityTimelineItems } from '../../src/lib/activityTimeline.js';

function formatStub(value) {
  return value ? `at:${String(value)}` : 'Never';
}

test('buildActivityTimelineItems preserves event-level history and skips generic fallback when rich history exists', () => {
  const timeline = buildActivityTimelineItems({
    activityHistory: [
      {
        id: 'evt_sent',
        event_type: 'proposal.sent',
        kind: 'file',
        tone: 'info',
        title: 'Opportunity Sent',
        description: 'You shared the current live opportunity.',
        created_date: '2026-03-25T10:00:00.000Z',
      },
      {
        id: 'evt_send_back',
        event_type: 'proposal.send_back',
        kind: 'clock',
        tone: 'neutral',
        title: 'Revised Terms Sent',
        description: 'Counterparty sent revised terms back.',
        created_date: '2026-03-25T10:05:00.000Z',
      },
    ],
    createdAt: '2026-03-20T00:00:00.000Z',
    updatedAt: '2026-03-21T00:00:00.000Z',
    hasLatestEvaluation: true,
    latestEvaluationTone: 'success',
    latestEvaluationTitle: 'AI Mediation Ready',
    latestEvaluationTimestamp: '2026-03-25T10:06:00.000Z',
    formatDateTime: formatStub,
  });

  assert.equal(timeline.length, 2);
  assert.deepEqual(
    timeline.map((entry) => entry.title),
    ['Opportunity Sent', 'Revised Terms Sent'],
  );
  assert.equal(timeline.some((entry) => entry.title === 'Opportunity Created'), false);
  assert.equal(timeline.some((entry) => entry.title === 'Last Updated'), false);
});

test('buildActivityTimelineItems keeps legacy fallback when no activity history exists', () => {
  const timeline = buildActivityTimelineItems({
    activityHistory: [],
    createdAt: '2026-03-20T00:00:00.000Z',
    updatedAt: '2026-03-21T00:00:00.000Z',
    hasLatestEvaluation: true,
    latestEvaluationTone: 'success',
    latestEvaluationTitle: 'AI Mediation Ready',
    latestEvaluationTimestamp: '2026-03-22T00:00:00.000Z',
    formatDateTime: formatStub,
  });

  assert.deepEqual(
    timeline.map((entry) => entry.title),
    ['Opportunity Created', 'Last Updated', 'AI Mediation Ready'],
  );
  assert.equal(timeline[2].tone, 'success');
  assert.equal(timeline[2].timestamp, 'at:2026-03-22T00:00:00.000Z');
});
