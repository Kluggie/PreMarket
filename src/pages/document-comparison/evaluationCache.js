function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asLower(value) {
  return asText(value).toLowerCase();
}

function toSafeInteger(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.floor(numeric);
}

export function defaultOwnerPermissions() {
  return {
    access_mode: 'owner',
    editable_side: 'a',
    can_edit_doc_a: true,
    can_edit_doc_b: false,
    has_token_access: false,
  };
}

export function buildComparisonQueryPayload({ comparison, proposal, permissions }) {
  if (!comparison || typeof comparison !== 'object') {
    return null;
  }

  const comparisonId = asText(comparison.id);
  const comparisonProposalId = asText(comparison.proposal_id || comparison.proposalId);
  const proposalFromInput =
    proposal && typeof proposal === 'object' && !Array.isArray(proposal)
      ? proposal
      : null;

  const normalizedProposal = proposalFromInput
    ? {
        ...proposalFromInput,
        id: asText(proposalFromInput.id) || comparisonProposalId || null,
        document_comparison_id:
          asText(proposalFromInput.document_comparison_id) || comparisonId || null,
      }
    : comparisonProposalId
      ? {
          id: comparisonProposalId,
          document_comparison_id: comparisonId || null,
        }
      : null;

  const normalizedPermissions =
    permissions && typeof permissions === 'object' && !Array.isArray(permissions)
      ? permissions
      : defaultOwnerPermissions();

  return {
    comparison,
    proposal: normalizedProposal,
    permissions: normalizedPermissions,
  };
}

export function buildOptimisticEvaluationHistoryEntry({
  comparison,
  proposalId = '',
  evaluationInputTrace = null,
}) {
  if (!comparison || typeof comparison !== 'object') {
    return null;
  }

  const evaluationResult =
    comparison.evaluation_result &&
    typeof comparison.evaluation_result === 'object' &&
    !Array.isArray(comparison.evaluation_result)
      ? comparison.evaluation_result
      : {};
  const resultInputTrace =
    evaluationResult.input_trace &&
    typeof evaluationResult.input_trace === 'object' &&
    !Array.isArray(evaluationResult.input_trace)
      ? evaluationResult.input_trace
      : {};
  const mergedInputTrace =
    evaluationInputTrace &&
    typeof evaluationInputTrace === 'object' &&
    !Array.isArray(evaluationInputTrace)
      ? { ...resultInputTrace, ...evaluationInputTrace }
      : resultInputTrace;

  const normalizedProposalId = asText(proposalId || comparison.proposal_id || comparison.proposalId);
  const normalizedInputSharedHash = asText(
    mergedInputTrace.shared_hash || mergedInputTrace.input_shared_hash,
  );
  const normalizedInputConfHash = asText(
    mergedInputTrace.confidential_hash || mergedInputTrace.input_conf_hash,
  );
  const providerRaw = asText(
    evaluationResult.evaluation_provider || evaluationResult.provider,
  );
  const modelRaw = asText(
    evaluationResult.evaluation_model ||
      evaluationResult.evaluation_provider_model ||
      evaluationResult.model,
  );
  const evaluationProvider = asLower(providerRaw) === 'vertex' ? 'vertex' : providerRaw ? 'fallback' : 'unknown';
  const evaluationProviderReason =
    evaluationProvider === 'fallback'
      ? asText(evaluationResult.evaluation_provider_reason || evaluationResult.fallbackReason) ||
        (asLower(providerRaw) === 'mock' ? 'vertex_mock_enabled' : 'provider_not_vertex')
      : null;
  const createdDate =
    comparison.updated_date ||
    comparison.updated_at ||
    comparison.updatedAt ||
    new Date().toISOString();

  return {
    id: `optimistic-${asText(comparison.id)}-${String(createdDate)}`,
    proposal_id: normalizedProposalId || null,
    source: 'document_comparison_vertex',
    status: 'completed',
    score: Number(evaluationResult.score || 0),
    summary: asText(evaluationResult.summary || evaluationResult.executive_summary),
    result: {
      ...evaluationResult,
      input_trace: mergedInputTrace,
    },
    evaluation_provider: evaluationProvider,
    evaluation_model: modelRaw || null,
    evaluation_provider_model: modelRaw || null,
    evaluation_provider_version: modelRaw || null,
    evaluation_provider_reason: evaluationProviderReason,
    created_date: createdDate,
    updated_date: createdDate,
    input_shared_hash: normalizedInputSharedHash || null,
    input_conf_hash: normalizedInputConfHash || null,
    input_shared_len: toSafeInteger(
      mergedInputTrace.shared_length || mergedInputTrace.input_shared_len,
    ),
    input_conf_len: toSafeInteger(
      mergedInputTrace.confidential_length || mergedInputTrace.input_conf_len,
    ),
    input_version: toSafeInteger(mergedInputTrace.input_version),
  };
}

export function mergeEvaluationHistoryWithOptimistic(current, optimisticEntry) {
  const existing = Array.isArray(current) ? current : [];
  if (!optimisticEntry || typeof optimisticEntry !== 'object') {
    return existing;
  }
  const withoutOptimistic = existing.filter(
    (entry) => !String(entry?.id || '').startsWith('optimistic-'),
  );
  return [optimisticEntry, ...withoutOptimistic];
}
