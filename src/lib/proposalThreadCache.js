import {
  matchesProposalListFilters,
  sortProposalRowsDesc,
} from './proposalThreadFilters.js';

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function mergeProposalRow(existing, updated) {
  const nextRow = {
    ...(existing && typeof existing === 'object' ? existing : {}),
    ...(updated && typeof updated === 'object' ? updated : {}),
  };

  if ((existing && typeof existing === 'object' && existing.outcome) || updated?.outcome) {
    nextRow.outcome = {
      ...(existing?.outcome && typeof existing.outcome === 'object' ? existing.outcome : {}),
      ...(updated?.outcome && typeof updated.outcome === 'object' ? updated.outcome : {}),
    };
  }

  return nextRow;
}

function updateProposalRows(rows, updatedProposal, filters, maxItems, options = {}) {
  if (!Array.isArray(rows) || !updatedProposal?.id) {
    return rows;
  }

  const proposalId = asText(updatedProposal.id);
  const existingRow = rows.find((row) => asText(row?.id) === proposalId) || null;
  const mergedRow = mergeProposalRow(existingRow, updatedProposal);
  const matchesFilters = matchesProposalListFilters(mergedRow, filters);
  const allowInsert = Boolean(options.allowInsert);
  const nextRows = rows.filter((row) => asText(row?.id) !== proposalId);

  if (matchesFilters && (allowInsert || existingRow)) {
    nextRows.push(mergedRow);
  }

  nextRows.sort(sortProposalRowsDesc);

  if (Number.isFinite(maxItems) && maxItems > 0 && nextRows.length > maxItems) {
    return nextRows.slice(0, maxItems);
  }

  return nextRows;
}

function removeProposalRows(rows, proposalId) {
  if (!Array.isArray(rows) || !proposalId) {
    return rows;
  }
  return rows.filter((row) => asText(row?.id) !== proposalId);
}

function updateProposalListCache(data, queryKey, updatedProposal) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.proposals)) {
    return data;
  }

  const [, tab, status, origin, query, cursor] = Array.isArray(queryKey) ? queryKey : [];
  const nextProposals = updateProposalRows(
    data.proposals,
    updatedProposal,
    { tab, status, origin, query },
    Number(data?.page?.limit || data.proposals.length || 0),
    { allowInsert: !cursor },
  );

  return nextProposals === data.proposals ? data : { ...data, proposals: nextProposals };
}

function removeProposalFromListCache(data, proposalId) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.proposals)) {
    return data;
  }

  const nextProposals = removeProposalRows(data.proposals, proposalId);
  return nextProposals === data.proposals ? data : { ...data, proposals: nextProposals };
}

function updateProposalDetailCache(data, updatedProposal) {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const detailProposalId = asText(data?.proposal?.id);
  const updatedProposalId = asText(updatedProposal?.id);
  if (!detailProposalId || detailProposalId !== updatedProposalId) {
    return data;
  }

  return {
    ...data,
    proposal: mergeProposalRow(data.proposal, updatedProposal),
  };
}

export function applyUpdatedProposalToCaches(queryClient, updatedProposal) {
  if (!queryClient || !updatedProposal?.id) {
    return;
  }

  queryClient.getQueriesData({ queryKey: ['proposals-list'] }).forEach(([queryKey, data]) => {
    const nextData = updateProposalListCache(data, queryKey, updatedProposal);
    if (nextData !== data) {
      queryClient.setQueryData(queryKey, nextData);
    }
  });

  queryClient.getQueriesData({ queryKey: ['dashboard-proposals-all'] }).forEach(([queryKey, data]) => {
    if (!Array.isArray(data)) {
      return;
    }
    const nextData = updateProposalRows(
      data,
      updatedProposal,
      { tab: 'all' },
      50,
      { allowInsert: true },
    );
    if (nextData !== data) {
      queryClient.setQueryData(queryKey, nextData);
    }
  });

  queryClient.getQueriesData({ queryKey: ['dashboard-proposals-agreement-requests'] }).forEach(([queryKey, data]) => {
    if (!Array.isArray(data)) {
      return;
    }
    const nextData = updateProposalRows(
      data,
      updatedProposal,
      { tab: 'all', status: 'win_confirmation_requested' },
      10,
      { allowInsert: true },
    );
    if (nextData !== data) {
      queryClient.setQueryData(queryKey, nextData);
    }
  });

  if (updatedProposal?.id) {
    const proposalId = asText(updatedProposal.id);
    if (proposalId) {
      queryClient.setQueryData(['proposal-detail', proposalId], (current) =>
        updateProposalDetailCache(current, updatedProposal),
      );
    }
  }
}

export function removeProposalFromCaches(queryClient, proposalId) {
  const normalizedProposalId = asText(proposalId);
  if (!queryClient || !normalizedProposalId) {
    return;
  }

  queryClient.getQueriesData({ queryKey: ['proposals-list'] }).forEach(([queryKey, data]) => {
    const nextData = removeProposalFromListCache(data, normalizedProposalId);
    if (nextData !== data) {
      queryClient.setQueryData(queryKey, nextData);
    }
  });

  queryClient.getQueriesData({ queryKey: ['dashboard-proposals-all'] }).forEach(([queryKey, data]) => {
    if (!Array.isArray(data)) {
      return;
    }
    const nextData = removeProposalRows(data, normalizedProposalId);
    if (nextData !== data) {
      queryClient.setQueryData(queryKey, nextData);
    }
  });

  queryClient.getQueriesData({ queryKey: ['dashboard-proposals-agreement-requests'] }).forEach(([queryKey, data]) => {
    if (!Array.isArray(data)) {
      return;
    }
    const nextData = removeProposalRows(data, normalizedProposalId);
    if (nextData !== data) {
      queryClient.setQueryData(queryKey, nextData);
    }
  });
}

export async function invalidateProposalThreadQueries(
  queryClient,
  {
    proposalId = null,
    documentComparisonId = null,
  } = {},
) {
  if (!queryClient) {
    return;
  }

  const invalidations = [
    { queryKey: ['proposals-list'] },
    { queryKey: ['dashboard-summary'] },
    { queryKey: ['dashboard-activity'] },
    { queryKey: ['dashboard-proposals-all'] },
    { queryKey: ['dashboard-proposals-agreement-requests'] },
  ];

  if (proposalId) {
    invalidations.unshift({ queryKey: ['proposal-detail', proposalId] });
  }

  if (documentComparisonId) {
    invalidations.unshift({ queryKey: ['proposal-linked-comparison', documentComparisonId] });
  }

  await Promise.all(invalidations.map((filters) => queryClient.invalidateQueries(filters)));
}
