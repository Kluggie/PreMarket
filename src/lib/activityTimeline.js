function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function defaultFormatDateTime(value) {
  if (!value) return 'Never';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Unknown';
  return parsed.toLocaleString();
}

function mapActivityHistoryToTimelineItems(activityHistory, formatDateTime) {
  return (Array.isArray(activityHistory) ? activityHistory : [])
    .map((item, index) => ({
      id: asText(item?.id) || `activity-${index}`,
      kind: asText(item?.kind) || 'clock',
      tone: asText(item?.tone) || 'neutral',
      title: asText(item?.title) || 'Update',
      description: asText(item?.description) || '',
      timestamp: formatDateTime(item?.created_date || item?.created_at || item?.timestamp || null),
    }))
    .filter((item) => item.title);
}

export function buildActivityTimelineItems(options = {}) {
  const formatDateTime =
    typeof options.formatDateTime === 'function' ? options.formatDateTime : defaultFormatDateTime;
  const mappedHistory = mapActivityHistoryToTimelineItems(options.activityHistory, formatDateTime);
  if (mappedHistory.length > 0) {
    return mappedHistory;
  }

  const fallback = [
    {
      id: 'created',
      kind: 'file',
      tone: 'info',
      title: 'Opportunity Created',
      timestamp: formatDateTime(options.createdAt || null),
    },
    {
      id: 'updated',
      kind: 'clock',
      tone: 'neutral',
      title: 'Last Updated',
      timestamp: formatDateTime(options.updatedAt || null),
    },
  ];

  if (options.hasLatestEvaluation) {
    fallback.push({
      id: 'latest-evaluation',
      kind: 'sparkles',
      tone: asText(options.latestEvaluationTone) || 'neutral',
      title: asText(options.latestEvaluationTitle) || 'AI Mediation Update',
      timestamp: formatDateTime(options.latestEvaluationTimestamp || null),
    });
  }

  return fallback;
}
