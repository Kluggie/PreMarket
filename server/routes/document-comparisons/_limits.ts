import { ApiError } from '../../_lib/errors.js';
import { getDocumentComparisonTextLimits } from '../../../src/config/aiLimits.js';

export function resolveDocumentComparisonLimits() {
  const modelName = String(process.env.VERTEX_MODEL || '').trim();
  return getDocumentComparisonTextLimits(modelName);
}

function countCharacters(value: unknown) {
  return String(value || '').length;
}

export function assertDocumentComparisonWithinLimits(params: {
  docAText: string;
  docBText: string;
}) {
  const limits = resolveDocumentComparisonLimits();
  const docAChars = countCharacters(params.docAText);
  const docBChars = countCharacters(params.docBText);
  const totalChars = docAChars + docBChars;

  if (docAChars > limits.perDocumentCharacterLimit || docBChars > limits.perDocumentCharacterLimit) {
    throw new ApiError(
      413,
      'payload_too_large',
      `Document is too large for ${limits.model}. Maximum per document is ${limits.perDocumentCharacterLimit.toLocaleString()} characters.`,
      {
        model: limits.model,
        per_document_character_limit: limits.perDocumentCharacterLimit,
        total_character_limit: limits.totalCharacterLimit,
      },
    );
  }

  if (totalChars > limits.totalCharacterLimit) {
    throw new ApiError(
      413,
      'payload_too_large',
      `Combined document length is too large for ${limits.model}. Maximum combined size is ${limits.totalCharacterLimit.toLocaleString()} characters.`,
      {
        model: limits.model,
        per_document_character_limit: limits.perDocumentCharacterLimit,
        total_character_limit: limits.totalCharacterLimit,
      },
    );
  }

  return {
    limits,
    docAChars,
    docBChars,
    totalChars,
  };
}
