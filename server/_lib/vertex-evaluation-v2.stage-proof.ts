import { evaluateWithVertexV2 } from './vertex-evaluation-v2.js';
import { MEDIATION_REVIEW_STAGE } from '../../src/lib/opportunityReviewStage.js';

void evaluateWithVertexV2({
  sharedText: 'Shared review text',
  confidentialText: 'Confidential review text',
  analysisStage: MEDIATION_REVIEW_STAGE,
});

// @ts-expect-error analysisStage is intentionally mandatory at the engine boundary.
void evaluateWithVertexV2({
  sharedText: 'Shared review text',
  confidentialText: 'Confidential review text',
});
