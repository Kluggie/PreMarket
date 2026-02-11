import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { buildSharedReportUrl, getPublicBaseUrl, SHARE_REPORT_PATH, validateShareUrl } from './_utils/shareUrl.ts';

function logInfo(payload: Record<string, unknown>) {
  console.log(JSON.stringify({ level: 'info', ...payload }));
}

function safeKeys(source: unknown): string[] {
  if (!source || typeof source !== 'object') return [];
  return Object.keys(source as Record<string, unknown>).sort();
}

function extractProposalId(source: any): string | null {
  if (!source || typeof source !== 'object') return null;
  const data = source.data && typeof source.data === 'object' ? source.data : {};
  return (
    source.proposal_id ||
    source.linked_proposal_id ||
    source.proposalId ||
    source.linkedProposalId ||
    data.proposal_id ||
    data.proposalId ||
    null
  );
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function extractRecipientEmail(source: any): string | null {
  if (!source || typeof source !== 'object') return null;
  const data = source.data && typeof source.data === 'object' ? source.data : {};
  const context = source.context && typeof source.context === 'object' ? source.context : {};
  const metadata = source.metadata && typeof source.metadata === 'object' ? source.metadata : {};

  return normalizeEmail(
    source.recipient_email ||
    source.recipientEmail ||
    data.recipient_email ||
    data.recipientEmail ||
    context.recipient_email ||
    context.recipientEmail ||
    metadata.recipient_email ||
    metadata.recipientEmail ||
    null
  );
}

function buildShareContextQuery(req: Request) {
  const appIdFromHeader = req.headers.get('Base44-App-Id');
  const functionsVersion = req.headers.get('Base44-Functions-Version');

  return {
    app_id: appIdFromHeader || undefined,
    functions_version: functionsVersion || undefined
  };
}

async function ensureProposalResponseRecords(base44: any, proposalId: string, correlationId: string) {
  const responseBuckets = await Promise.all([
    base44.asServiceRole.entities.ProposalResponse.filter({ proposal_id: proposalId }).catch(() => []),
    base44.asServiceRole.entities.ProposalResponse.filter({ proposalId: proposalId }).catch(() => []),
    base44.asServiceRole.entities.ProposalResponse.filter({ 'data.proposal_id': proposalId }).catch(() => []),
    base44.asServiceRole.entities.ProposalResponse.filter({ 'data.proposalId': proposalId }).catch(() => [])
  ]);
  const existing = responseBuckets.flat();
  
  if (existing.length > 0) {
    console.log(`[${correlationId}] ProposalResponse records exist: ${existing.length}`);
    return { materialized: false, count: existing.length };
  }

  const evalItems = await base44.asServiceRole.entities.EvaluationItem.filter({ linked_proposal_id: proposalId }, '-created_date', 1).catch(() => []);
  const evalItem = evalItems?.[0] || null;
  const stepStateJson = evalItem?.step_state_json || null;
  
  if (!stepStateJson) {
    console.log(`[${correlationId}] No step_state_json available to materialize responses`);
    return { materialized: false, count: 0 };
  }

  const rawResponses = stepStateJson?.responses || {};
  const rawVisibility = stepStateJson?.visibilitySettings || {};
  const templates = await base44.asServiceRole.entities.Template.list().catch(() => []);
  const proposal = await base44.asServiceRole.entities.Proposal.filter({ id: proposalId }, '-created_date', 1).then(p => p?.[0] || null);
  const template = templates.find((t: any) => t.id === proposal?.template_id) || null;
  const questionLookup: Record<string, any> = {};
  if (template?.questions) {
    template.questions.forEach((q: any) => {
      if (q?.id) questionLookup[q.id] = q;
    });
  }

  const responseRecords: any[] = [];
  for (const [responseKey, rawValue] of Object.entries(rawResponses)) {
    if (responseKey.startsWith('_')) continue;
    
    const [questionId, subjectFromKey] = responseKey.includes('__') 
      ? responseKey.split('__') 
      : [responseKey, null];
    
    if (!questionId) continue;
    const question = questionLookup[questionId] || null;
    
    let subjectParty = 'a';
    const normalizedFromKey = String(subjectFromKey || '').trim().toLowerCase();
    if (normalizedFromKey === 'b' || normalizedFromKey === 'party_b' || normalizedFromKey === 'recipient') {
      subjectParty = 'b';
    } else if (question) {
      const party = String(question?.party || question?.party_key || question?.subject_party || '').toLowerCase();
      if (party === 'b' || party === 'party_b' || party === 'recipient' || party === 'counterparty') {
        subjectParty = 'b';
      } else if (question?.is_about_counterparty === true) {
        subjectParty = 'b';
      }
    }
    
    const visibility = String(rawVisibility[responseKey] ?? rawVisibility[questionId] ?? 'full').toLowerCase();
    const normalizedVisibility = ['hidden', 'not_shared', 'private', 'confidential'].includes(visibility) ? 'hidden' : 'full';
    
    let valueType = 'text';
    let value: any = rawValue;
    let rangeMin: number | null = null;
    let rangeMax: number | null = null;
    
    if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
      const type = String((rawValue as any).type || '').toLowerCase();
      if (type === 'range') {
        valueType = 'range';
        value = null;
        rangeMin = Number((rawValue as any).min);
        rangeMax = Number((rawValue as any).max);
        if (!Number.isFinite(rangeMin)) rangeMin = null;
        if (!Number.isFinite(rangeMax)) rangeMax = null;
      }
    }
    
    const responseData = {
      proposal_id: proposalId,
      question_id: questionId,
      entered_by_party: 'a',
      author_party: 'a',
      subject_party: subjectParty,
      is_about_counterparty: subjectParty === 'b',
      value_type: valueType,
      value: value === null || value === undefined ? null : String(value),
      range_min: rangeMin,
      range_max: rangeMax,
      visibility: normalizedVisibility
    };
    
    responseRecords.push(responseData);
  }

  if (responseRecords.length === 0) {
    console.log(`[${correlationId}] No responses to materialize from step_state_json`);
    return { materialized: false, count: 0 };
  }

  const created = await base44.asServiceRole.entities.ProposalResponse.bulkCreate(responseRecords);
  console.log(`[${correlationId}] Materialized ${created.length} ProposalResponse records from step_state_json`);
  
  return { materialized: true, count: created.length };
}

Deno.serve(async (req) => {
  const correlationId = `sharelink_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      console.log(`[${correlationId}] Unauthorized access attempt`);
      return Response.json({
        ok: false,
        errorCode: 'UNAUTHORIZED',
        message: 'Authentication required',
        correlationId
      }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { proposalId, evaluationItemId, documentComparisonId, recipientEmail } = body;
    let resolvedProposalId = proposalId || null;
    
    const normalizedRecipientEmail = normalizeEmail(recipientEmail);
    if (!normalizedRecipientEmail || !normalizedRecipientEmail.includes('@')) {
      console.log(`[${correlationId}] Invalid email provided`);
      return Response.json({
        ok: false,
        errorCode: 'INVALID_EMAIL',
        message: 'Valid recipient email is required',
        correlationId
      }, { status: 400 });
    }

    // Validate that at least one ID is provided
    if (!proposalId && !evaluationItemId && !documentComparisonId) {
      console.log(`[${correlationId}] Missing ID parameter`);
      return Response.json({
        ok: false,
        errorCode: 'INVALID_INPUT',
        message: 'proposalId, evaluationItemId, or documentComparisonId is required',
        correlationId
      }, { status: 400 });
    }

    // Validate and resolve proposal linkage from the provided identifiers.
    if (proposalId) {
      const proposals = await base44.asServiceRole.entities.Proposal.filter({ id: proposalId }, '-created_date', 1);
      if (proposals.length === 0) {
        console.log(`[${correlationId}] Proposal not found: ${proposalId}`);
        return Response.json({
          ok: false,
          errorCode: 'NOT_FOUND',
          message: 'Proposal not found',
          correlationId
        }, { status: 404 });
      }
    }

    if (evaluationItemId) {
      const items = await base44.asServiceRole.entities.EvaluationItem.filter({ id: evaluationItemId }, '-created_date', 1);
      if (items.length === 0) {
        console.log(`[${correlationId}] Evaluation item not found: ${evaluationItemId}`);
        return Response.json({
          ok: false,
          errorCode: 'NOT_FOUND',
          message: 'Evaluation item not found',
          correlationId
        }, { status: 404 });
      }
      if (!resolvedProposalId) {
        resolvedProposalId = extractProposalId(items[0]);
      }
    }

    if (documentComparisonId) {
      const comparisons = await base44.asServiceRole.entities.DocumentComparison.filter({ id: documentComparisonId }, '-created_date', 1);
      if (comparisons.length === 0) {
        console.log(`[${correlationId}] Document comparison not found: ${documentComparisonId}`);
        return Response.json({
          ok: false,
          errorCode: 'NOT_FOUND',
          message: 'Document comparison not found',
          correlationId
        }, { status: 404 });
      }
      if (!resolvedProposalId) {
        resolvedProposalId = extractProposalId(comparisons[0]);
      }
    }

    if (!resolvedProposalId) {
      logInfo({
        correlationId,
        event: 'share_link_resolution_failed',
        proposalId: proposalId || null,
        evaluationItemId: evaluationItemId || null,
        documentComparisonId: documentComparisonId || null,
        resolvedProposalId: null
      });
      return Response.json({
        ok: false,
        errorCode: 'MISSING_PROPOSAL_ID',
        message: 'Share link must be linked to a proposal',
        correlationId
      }, { status: 400 });
    }

    const resolvedProposals = await base44.asServiceRole.entities.Proposal.filter({ id: resolvedProposalId }, '-created_date', 1);
    if (resolvedProposals.length === 0) {
      return Response.json({
        ok: false,
        errorCode: 'NOT_FOUND',
        message: 'Resolved proposal not found',
        correlationId
      }, { status: 404 });
    }
    const resolvedProposal = resolvedProposals[0];
    const normalizedUserEmail = typeof user.email === 'string' ? user.email.trim().toLowerCase() : '';
    const normalizedOwnerEmail = typeof resolvedProposal.party_a_email === 'string'
      ? resolvedProposal.party_a_email.trim().toLowerCase()
      : '';
    const currentUserId = typeof user.id === 'string' ? user.id.trim() : '';
    const ownerUserId = typeof resolvedProposal.party_a_user_id === 'string'
      ? resolvedProposal.party_a_user_id.trim()
      : (typeof resolvedProposal.created_by_user_id === 'string' ? resolvedProposal.created_by_user_id.trim() : '');
    const isProposalOwner =
      (currentUserId && ownerUserId && currentUserId === ownerUserId) ||
      (normalizedUserEmail && normalizedOwnerEmail && normalizedUserEmail === normalizedOwnerEmail);

    if (!isProposalOwner) {
      logInfo({
        correlationId,
        event: 'share_link_owner_check_failed',
        proposalId: resolvedProposalId,
        userId: user.id,
        proposalPartyAUserId: resolvedProposal.party_a_user_id || null
      });
      return Response.json({
        ok: false,
        errorCode: 'FORBIDDEN',
        message: 'Only the proposal owner can create a share link',
        correlationId
      }, { status: 403 });
    }

    let snapshotId: string | null = null;
    let snapshotVersion: number | null = null;
    try {
      const snapshotResult = await base44.asServiceRole.functions.invoke('CreateProposalSnapshot', {
        sourceProposalId: resolvedProposalId,
        recipientEmail: normalizedRecipientEmail,
        createdByUserId: user.id
      });

      if (!snapshotResult?.data?.ok || !snapshotResult?.data?.snapshotId) {
        const errorCode = snapshotResult?.data?.errorCode || 'SNAPSHOT_CREATE_FAILED';
        const message = snapshotResult?.data?.message || 'Failed to create proposal snapshot';
        logInfo({
          correlationId,
          event: 'snapshot_create_failed',
          proposalId: resolvedProposalId,
          recipientEmail: normalizedRecipientEmail,
          errorCode,
          message
        });
        return Response.json({
          ok: false,
          errorCode,
          message,
          correlationId
        }, { status: snapshotResult?.status || 500 });
      }

      snapshotId = String(snapshotResult.data.snapshotId);
      const versionCandidate = Number(snapshotResult.data.version);
      snapshotVersion = Number.isFinite(versionCandidate) ? versionCandidate : null;
    } catch (snapshotError) {
      const errorMessage = snapshotError instanceof Error ? snapshotError.message : String(snapshotError);
      logInfo({
        correlationId,
        event: 'snapshot_create_exception',
        proposalId: resolvedProposalId,
        recipientEmail: normalizedRecipientEmail,
        error: errorMessage
      });
      return Response.json({
        ok: false,
        errorCode: 'SNAPSHOT_CREATE_FAILED',
        message: errorMessage,
        correlationId
      }, { status: 500 });
    }

    const shareMode = 'interactive';
    const permissions = {
      canView: true,
      canEdit: true,
      canEditRecipientSide: true,
      canReevaluate: true,
      canSendBack: true
    };

    // Generate random token
    const token = crypto.randomUUID() + '_' + Math.random().toString(36).substring(2, 15);
    
    // Set expiration (14 days from now)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 14);

    console.log(`[${correlationId}] Creating share link for recipient domain: ${normalizedRecipientEmail.split('@')[1]}`);
    logInfo({
      correlationId,
      event: 'share_link_resolved',
      proposalId: proposalId || null,
      evaluationItemId: evaluationItemId || null,
      documentComparisonId: documentComparisonId || null,
      resolvedProposalId
    });

    // Create ShareLink with snapshot data
    const shareLink = await base44.asServiceRole.entities.ShareLink.create({
      proposal_id: resolvedProposalId,
      proposalId: resolvedProposalId,
      source_proposal_id: resolvedProposalId,
      sourceProposalId: resolvedProposalId,
      linked_proposal_id: resolvedProposalId,
      snapshot_id: snapshotId,
      snapshotId: snapshotId,
      snapshot_version: snapshotVersion,
      snapshotVersion: snapshotVersion,
      evaluation_item_id: evaluationItemId || null,
      document_comparison_id: documentComparisonId || null,
      recipient_email: normalizedRecipientEmail,
      recipientEmail: normalizedRecipientEmail,
      token: token,
      token_hash: token,
      expires_at: expiresAt.toISOString(),
      max_uses: 25,
      uses: 0,
      created_by_user_id: user.id,
      status: 'active'
    });

    logInfo({
      correlationId,
      event: 'share_link_created_raw',
      shareLinkId: shareLink.id,
      token,
      resolvedProposalId,
      snapshotId,
      snapshotVersion,
      hasSnapshotId: !!shareLink.snapshot_id || !!shareLink.snapshotId,
      shareLinkKeys: safeKeys(shareLink)
    });

    const existingContext = shareLink.context && typeof shareLink.context === 'object' ? shareLink.context : {};
    const existingMetadata = shareLink.metadata && typeof shareLink.metadata === 'object' ? shareLink.metadata : {};
    const linkagePatches: Array<{ label: string; payload: Record<string, unknown> }> = [
      {
        label: 'proposal_id',
        payload: { proposal_id: resolvedProposalId }
      },
      {
        label: 'proposalId',
        payload: { proposalId: resolvedProposalId }
      },
      {
        label: 'linked_proposal_id',
        payload: { linked_proposal_id: resolvedProposalId }
      },
      {
        label: 'linkedProposalId',
        payload: { linkedProposalId: resolvedProposalId }
      },
      {
        label: 'source_proposal_id',
        payload: { source_proposal_id: resolvedProposalId }
      },
      {
        label: 'sourceProposalId',
        payload: { sourceProposalId: resolvedProposalId }
      },
      {
        label: 'snapshot_id',
        payload: { snapshot_id: snapshotId }
      },
      {
        label: 'snapshotId',
        payload: { snapshotId: snapshotId }
      },
      {
        label: 'snapshot_version',
        payload: { snapshot_version: snapshotVersion }
      },
      {
        label: 'snapshotVersion',
        payload: { snapshotVersion: snapshotVersion }
      },
      {
        label: 'recipient_email',
        payload: { recipient_email: normalizedRecipientEmail }
      },
      {
        label: 'recipientEmail',
        payload: { recipientEmail: normalizedRecipientEmail }
      },
      {
        label: 'context',
        payload: {
          context: {
            ...existingContext,
            proposalId: resolvedProposalId,
            proposal_id: resolvedProposalId,
            linkedProposalId: resolvedProposalId,
            linked_proposal_id: resolvedProposalId,
            sourceProposalId: resolvedProposalId,
            source_proposal_id: resolvedProposalId,
            snapshotId,
            snapshot_id: snapshotId,
            snapshotVersion: snapshotVersion,
            snapshot_version: snapshotVersion,
            recipientEmail: normalizedRecipientEmail,
            recipient_email: normalizedRecipientEmail
          }
        }
      },
      {
        label: 'metadata',
        payload: {
          metadata: {
            ...existingMetadata,
            proposalId: resolvedProposalId,
            proposal_id: resolvedProposalId,
            linkedProposalId: resolvedProposalId,
            linked_proposal_id: resolvedProposalId,
            sourceProposalId: resolvedProposalId,
            source_proposal_id: resolvedProposalId,
            snapshotId,
            snapshot_id: snapshotId,
            snapshotVersion: snapshotVersion,
            snapshot_version: snapshotVersion,
            recipientEmail: normalizedRecipientEmail,
            recipient_email: normalizedRecipientEmail
          }
        }
      }
    ];

    for (const patch of linkagePatches) {
      try {
        await base44.asServiceRole.entities.ShareLink.update(shareLink.id, patch.payload);
        logInfo({
          correlationId,
          event: 'share_link_linkage_patch',
          shareLinkId: shareLink.id,
          token,
          resolvedProposalId,
          patch: patch.label,
          payloadKeys: safeKeys(patch.payload),
          ok: true
        });
      } catch (error) {
        logInfo({
          correlationId,
          event: 'share_link_linkage_patch',
          shareLinkId: shareLink.id,
          token,
          resolvedProposalId,
          patch: patch.label,
          payloadKeys: safeKeys(patch.payload),
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    try {
      const refreshedRows = await base44.asServiceRole.entities.ShareLink.filter({ id: shareLink.id }, '-created_date', 1);
      const refreshedShareLink = refreshedRows?.[0] || null;
      if (!refreshedShareLink) {
        logInfo({
          correlationId,
          event: 'share_link_linkage_state',
          shareLinkId: shareLink.id,
          token,
          resolvedProposalId,
          found: false
        });
      } else {
        const refreshedContext = refreshedShareLink.context && typeof refreshedShareLink.context === 'object'
          ? refreshedShareLink.context
          : {};
        const refreshedMetadata = refreshedShareLink.metadata && typeof refreshedShareLink.metadata === 'object'
          ? refreshedShareLink.metadata
          : {};
        logInfo({
          correlationId,
          event: 'share_link_linkage_state',
          shareLinkId: refreshedShareLink.id || shareLink.id,
          token,
          resolvedProposalId,
          shareLinkKeys: safeKeys(refreshedShareLink),
          proposal_id: refreshedShareLink.proposal_id || null,
          proposalId: refreshedShareLink.proposalId || null,
          contextProposalId: refreshedContext.proposalId || null,
          contextProposalIdSnake: refreshedContext.proposal_id || null,
          contextLinkedProposalId: refreshedContext.linkedProposalId || null,
          contextLinkedProposalIdSnake: refreshedContext.linked_proposal_id || null,
          metadataProposalId: refreshedMetadata.proposalId || null,
          metadataProposalIdSnake: refreshedMetadata.proposal_id || null,
          metadataLinkedProposalId: refreshedMetadata.linkedProposalId || null,
          metadataLinkedProposalIdSnake: refreshedMetadata.linked_proposal_id || null,
          snapshotId: refreshedShareLink.snapshotId || refreshedShareLink.snapshot_id || null,
          snapshotVersion: refreshedShareLink.snapshotVersion || refreshedShareLink.snapshot_version || null,
          contextSnapshotId: refreshedContext.snapshotId || refreshedContext.snapshot_id || null,
          contextSnapshotVersion: refreshedContext.snapshotVersion || refreshedContext.snapshot_version || null,
          metadataSnapshotId: refreshedMetadata.snapshotId || refreshedMetadata.snapshot_id || null,
          metadataSnapshotVersion: refreshedMetadata.snapshotVersion || refreshedMetadata.snapshot_version || null,
          recipient_email: refreshedShareLink.recipient_email || null,
          recipientEmail: refreshedShareLink.recipientEmail || null,
          contextRecipientEmail: refreshedContext.recipientEmail || null,
          contextRecipientEmailSnake: refreshedContext.recipient_email || null,
          metadataRecipientEmail: refreshedMetadata.recipientEmail || null,
          metadataRecipientEmailSnake: refreshedMetadata.recipient_email || null,
          found: true
        });

        const persistedRecipient = extractRecipientEmail(refreshedShareLink);
        if (persistedRecipient !== normalizedRecipientEmail) {
          try {
            await base44.asServiceRole.entities.ShareLink.update(shareLink.id, { status: 'inactive' });
          } catch (deactivateError) {
            logInfo({
              correlationId,
              event: 'share_link_recipient_pin_deactivate_failed',
              shareLinkId: shareLink.id,
              error: deactivateError instanceof Error ? deactivateError.message : String(deactivateError)
            });
          }

          return Response.json({
            ok: false,
            errorCode: 'RECIPIENT_PIN_FAILED',
            message: 'Failed to persist recipient restriction. Link was not activated.',
            correlationId
          }, { status: 500 });
        }
      }
    } catch (error) {
      logInfo({
        correlationId,
        event: 'share_link_linkage_state',
        shareLinkId: shareLink.id,
        token,
        resolvedProposalId,
        found: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // Build share URL from canonical share path (enforces APP_BASE_URL only)
    let shareUrl;
    let baseUrl;
    const shareContextQuery = buildShareContextQuery(req);
    try {
      baseUrl = getPublicBaseUrl();
      shareUrl = buildSharedReportUrl(token, shareContextQuery);
      validateShareUrl(shareUrl); // Hard guardrail

      const parsedUrl = new URL(shareUrl);
      if (parsedUrl.pathname !== SHARE_REPORT_PATH) {
        console.error(`[${correlationId}] NON_CANONICAL_SHARE_PATH`, {
          pathname: parsedUrl.pathname,
          shareUrl
        });
        throw new Error(`NON_CANONICAL_SHARE_PATH:${parsedUrl.pathname}`);
      }
    } catch (urlError) {
      const urlErrorMessage = urlError instanceof Error ? urlError.message : String(urlError);
      console.error(`[${correlationId}] URL construction failed:`, urlErrorMessage);
      return Response.json({
        ok: false,
        errorCode:
          urlErrorMessage.includes('NON_CANONICAL_SHARE_PATH')
            ? 'NON_CANONICAL_SHARE_PATH'
            : (urlErrorMessage.includes('APP_BASE_URL') ? 'APP_BASE_URL_MISSING' : 'BAD_SHARE_LINK_DOMAIN'),
        message: urlErrorMessage,
        correlationId
      }, { status: 500 });
    }
    
    // Store canonical URL context and, when available in schema, explicit sharing policy metadata.
    const metadataPatch: Record<string, unknown> = {
      base_url_used: `${baseUrl}${SHARE_REPORT_PATH}`
    };

    if (Object.prototype.hasOwnProperty.call(shareLink, 'share_mode')) {
      metadataPatch.share_mode = shareMode;
    }
    if (Object.prototype.hasOwnProperty.call(shareLink, 'mode')) {
      metadataPatch.mode = shareMode;
    }
    if (Object.prototype.hasOwnProperty.call(shareLink, 'permissions_json')) {
      metadataPatch.permissions_json = permissions;
    }
    if (Object.prototype.hasOwnProperty.call(shareLink, 'max_views')) {
      metadataPatch.max_views = 25;
    }
    if (Object.prototype.hasOwnProperty.call(shareLink, 'view_count')) {
      metadataPatch.view_count = 0;
    }
    if (Object.prototype.hasOwnProperty.call(shareLink, 'app_id_used') && shareContextQuery.app_id) {
      metadataPatch.app_id_used = shareContextQuery.app_id;
    }
    if (Object.prototype.hasOwnProperty.call(shareLink, 'functions_version_used') && shareContextQuery.functions_version) {
      metadataPatch.functions_version_used = shareContextQuery.functions_version;
    }
    if (Object.prototype.hasOwnProperty.call(shareLink, 'recipient_email')) {
      metadataPatch.recipient_email = normalizedRecipientEmail;
    }
    if (Object.prototype.hasOwnProperty.call(shareLink, 'recipientEmail')) {
      metadataPatch.recipientEmail = normalizedRecipientEmail;
    }
    if (Object.prototype.hasOwnProperty.call(shareLink, 'snapshot_id')) {
      metadataPatch.snapshot_id = snapshotId;
    }
    if (Object.prototype.hasOwnProperty.call(shareLink, 'snapshotId')) {
      metadataPatch.snapshotId = snapshotId;
    }
    if (Object.prototype.hasOwnProperty.call(shareLink, 'snapshot_version')) {
      metadataPatch.snapshot_version = snapshotVersion;
    }
    if (Object.prototype.hasOwnProperty.call(shareLink, 'snapshotVersion')) {
      metadataPatch.snapshotVersion = snapshotVersion;
    }
    if (Object.prototype.hasOwnProperty.call(shareLink, 'source_proposal_id')) {
      metadataPatch.source_proposal_id = resolvedProposalId;
    }
    if (Object.prototype.hasOwnProperty.call(shareLink, 'sourceProposalId')) {
      metadataPatch.sourceProposalId = resolvedProposalId;
    }

    await base44.asServiceRole.entities.ShareLink.update(shareLink.id, metadataPatch);

    if (snapshotId) {
      try {
        await base44.asServiceRole.entities.ProposalSnapshot.update(snapshotId, {
          shareLinkId: shareLink.id,
          share_link_id: shareLink.id
        });
      } catch (snapshotPatchError) {
        logInfo({
          correlationId,
          event: 'snapshot_share_link_patch_failed',
          snapshotId,
          shareLinkId: shareLink.id,
          error: snapshotPatchError instanceof Error ? snapshotPatchError.message : String(snapshotPatchError)
        });
      }
    }

    logInfo({
      correlationId,
      event: 'share_link_created',
      shareLinkId: shareLink.id,
      proposalId: resolvedProposalId,
      evaluationItemId: evaluationItemId || null,
      documentComparisonId: documentComparisonId || null
    });

    // Read back to verify snapshotId persisted
    const verifyRows = await base44.asServiceRole.entities.ShareLink.filter({ id: shareLink.id }, '-created_date', 1);
    const verifiedShareLink = verifyRows?.[0] || shareLink;
    const persistedSnapshotId = verifiedShareLink?.snapshot_id || verifiedShareLink?.snapshotId || null;
    
    console.log(`[ShareLinkSave]`, JSON.stringify({
      correlationId,
      shareLinkId: shareLink.id,
      snapshotId,
      snapshotVersion,
      snapshotIdPersisted: persistedSnapshotId,
      hasSnapshotId: !!persistedSnapshotId,
      verified: snapshotId === persistedSnapshotId
    }));

    return Response.json({
      ok: true,
      shareUrl,
      token,
      proposalId: resolvedProposalId,
      sourceProposalId: resolvedProposalId,
      shareLinkId: shareLink.id,
      snapshotId,
      version: snapshotVersion,
      expiresAt: expiresAt.toISOString(),
      viewCount: 0,
      maxViews: 25,
      mode: shareMode,
      permissions,
      appContext: shareContextQuery,
      debug: {
        hasSnapshotId: !!persistedSnapshotId,
        snapshotIdPersisted: persistedSnapshotId,
        usedFallback: false
      },
      correlationId
    });

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`[${correlationId}] CreateShareLink error:`, error);
    return Response.json({
      ok: false,
      errorCode: 'INTERNAL_ERROR',
      message: err.message || 'Failed to create share link',
      correlationId
    }, { status: 500 });
  }
});