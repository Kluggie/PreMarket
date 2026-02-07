import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const correlationId = `run_eval_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ 
        ok: false,
        errorCode: 'UNAUTHORIZED',
        error: 'Unauthorized',
        message: 'You must be logged in to run evaluations',
        correlationId 
      }, { status: 401 });
    }

    const { evaluationItemId, initiatedByRole, draftPayloadOptional, force } = await req.json();
    
    if (!evaluationItemId) {
      return Response.json({
        ok: false,
        errorCode: 'MISSING_ITEM_ID',
        error: 'Missing evaluationItemId',
        message: 'Evaluation item ID is required',
        correlationId
      }, { status: 400 });
    }

    // Load evaluation item
    const items = await base44.asServiceRole.entities.EvaluationItem.filter({ id: evaluationItemId });
    const item = items[0];
    
    if (!item) {
      return Response.json({
        ok: false,
        errorCode: 'ITEM_NOT_FOUND',
        error: 'Evaluation item not found',
        message: 'The evaluation item does not exist',
        correlationId
      }, { status: 404 });
    }

    // Check cycle limit
    const existingRuns = await base44.asServiceRole.entities.EvaluationRun.filter({ 
      evaluation_item_id: evaluationItemId 
    });
    
    const maxCycles = 6;
    const currentCycleIndex = existingRuns.length;
    
    if (currentCycleIndex >= maxCycles) {
      return Response.json({
        ok: false,
        errorCode: 'CYCLE_LIMIT_REACHED',
        error: 'Maximum evaluation cycles reached',
        message: `You've reached the maximum of ${maxCycles} evaluation cycles for this item. No further evaluations are allowed.`,
        detailsSafe: `Current cycle: ${currentCycleIndex}, max: ${maxCycles}`,
        correlationId
      }, { status: 400 });
    }

    // Create new evaluation run
    const newRun = await base44.asServiceRole.entities.EvaluationRun.create({
      evaluation_item_id: evaluationItemId,
      cycle_index: currentCycleIndex,
      initiated_by_role: initiatedByRole || 'party_a',
      created_by_user_id: user.id,
      status: 'running',
      correlation_id: correlationId
    });

    console.log(`[RunEvaluation] Created run ${newRun.id}, cycle ${currentCycleIndex}, correlationId: ${correlationId}`);

    // Route to appropriate evaluation function based on type
    let evalResult;
    
    if (item.type === 'document_comparison') {
      if (!item.linked_document_comparison_id) {
        await base44.asServiceRole.entities.EvaluationRun.update(newRun.id, {
          status: 'failed',
          error_message: 'No linked document comparison'
        });
        
        return Response.json({
          ok: false,
          errorCode: 'MISSING_LINKED_ENTITY',
          error: 'No linked document comparison',
          message: 'This evaluation item has no linked comparison',
          correlationId
        }, { status: 400 });
      }
      
      evalResult = await base44.asServiceRole.functions.invoke('EvaluateDocumentComparison', {
        comparison_id: item.linked_document_comparison_id
      });
      
    } else if (item.type === 'proposal') {
      if (!item.linked_proposal_id) {
        await base44.asServiceRole.entities.EvaluationRun.update(newRun.id, {
          status: 'failed',
          error_message: 'No linked proposal'
        });
        
        return Response.json({
          ok: false,
          errorCode: 'MISSING_LINKED_ENTITY',
          error: 'No linked proposal',
          message: 'This evaluation item has no linked proposal',
          correlationId
        }, { status: 400 });
      }
      
      evalResult = await base44.asServiceRole.functions.invoke('EvaluateProposal', {
        proposal_id: item.linked_proposal_id,
        force: Boolean(force)
      });
      
    } else if (item.type === 'profile_matching') {
      if (!item.linked_proposal_id) {
        await base44.asServiceRole.entities.EvaluationRun.update(newRun.id, {
          status: 'failed',
          error_message: 'No linked proposal'
        });
        
        return Response.json({
          ok: false,
          errorCode: 'MISSING_LINKED_ENTITY',
          error: 'No linked proposal',
          message: 'This evaluation item has no linked proposal',
          correlationId
        }, { status: 400 });
      }
      
      evalResult = await base44.asServiceRole.functions.invoke('EvaluateFitCardShared', {
        proposal_id: item.linked_proposal_id
      });
      
    } else {
      await base44.asServiceRole.entities.EvaluationRun.update(newRun.id, {
        status: 'failed',
        error_message: 'Unknown evaluation type'
      });
      
      return Response.json({
        ok: false,
        errorCode: 'UNKNOWN_TYPE',
        error: 'Unknown evaluation type',
        message: `Evaluation type '${item.type}' is not supported`,
        correlationId
      }, { status: 400 });
    }

    if (!evalResult.data?.ok) {
      const errorCode = evalResult?.data?.errorCode || 'EVAL_FUNCTION_FAILED';
      const retryAfterSeconds = Number(evalResult?.data?.retryAfterSeconds || 0);
      const baseErrorMessage = evalResult?.data?.error || 'Evaluation failed';
      const errorMessageWithRetry =
        errorCode === 'RATE_LIMITED' && retryAfterSeconds > 0
          ? `${baseErrorMessage} (retryAfterSeconds=${retryAfterSeconds})`
          : baseErrorMessage;

      if (errorCode === 'RATE_LIMITED') {
        try {
          await base44.asServiceRole.entities.EvaluationRun.update(newRun.id, {
            status: 'rate_limited',
            error_message: errorMessageWithRetry
          });
        } catch (_) {
          await base44.asServiceRole.entities.EvaluationRun.update(newRun.id, {
            status: 'blocked',
            error_message: errorMessageWithRetry
          });
        }
      } else {
        await base44.asServiceRole.entities.EvaluationRun.update(newRun.id, {
          status: 'failed',
          error_message: errorMessageWithRetry
        });
      }

      const status =
        errorCode === 'RATE_LIMITED'
          ? 200
          : errorCode === 'UNAUTHORIZED'
            ? 401
            : errorCode === 'MISSING_PROPOSAL_ID' || errorCode === 'MISSING_LINKED_ENTITY'
              ? 400
              : errorCode === 'PROPOSAL_NOT_FOUND' || errorCode === 'TEMPLATE_NOT_FOUND'
                ? 404
                : 500;

      return Response.json({
        ok: false,
        errorCode,
        error: evalResult?.data?.error,
        message: evalResult?.data?.message || 'Evaluation function failed',
        detailsSafe: evalResult?.data?.detailsSafe,
        retryAfterSeconds,
        correlationId: evalResult?.data?.correlationId || correlationId
      }, { status });
    }

    // Store internal report and build public report
    const internalReport = evalResult.data.report || evalResult.data.internal_report || {};
    
    // Gather evaluation responses for sanitization
    let evaluationResponses = [];
    if (item.linked_proposal_id) {
      evaluationResponses = await base44.asServiceRole.entities.ProposalResponse.filter({
        proposal_id: item.linked_proposal_id
      });
    }
    
    // Build public report (sanitized)
    const publicReportResult = await base44.asServiceRole.functions.invoke('BuildPublicReport', {
      internalReportJson: internalReport,
      evaluationResponses: evaluationResponses
    });
    
    const publicReport = publicReportResult.data.ok 
      ? publicReportResult.data.publicReportJson 
      : internalReport; // Fallback to internal if sanitization fails

    // Update run with success
    await base44.asServiceRole.entities.EvaluationRun.update(newRun.id, {
      status: 'completed',
      public_report_json: publicReport,
      internal_report_json: internalReport,
      model_meta_json: {
        model: evalResult.data.model || 'gemini-2.0-flash-exp',
        timestamp: new Date().toISOString()
      }
    });

    // Update item's active run
    await base44.asServiceRole.entities.EvaluationItem.update(evaluationItemId, {
      active_run_id: newRun.id,
      status: 'completed'
    });

    console.log(`[RunEvaluation] Success, run ${newRun.id}, correlationId: ${correlationId}`);

    return Response.json({
      ok: true,
      runId: newRun.id,
      cycleIndex: currentCycleIndex,
      report: publicReport,
      public_report: publicReport,
      correlationId
    });

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error('[RunEvaluation] Error:', err.message, 'correlationId:', correlationId);
    console.error('[RunEvaluation] Stack:', err.stack);
    
    return Response.json({
      ok: false,
      errorCode: 'INTERNAL_ERROR',
      error: err.message,
      message: 'Evaluation runner failed with internal error',
      detailsSafe: err.message,
      correlationId
    }, { status: 500 });
  }
});
