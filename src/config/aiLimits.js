const DEFAULT_VERTEX_MODEL = 'gemini-2.0-flash-001';

const MODEL_INPUT_TOKEN_LIMITS = {
  'gemini-2.0-flash-001': 1_000_000,
  'gemini-1.5-flash-002': 1_000_000,
  'gemini-1.5-flash-001': 1_000_000,
  'gemini-1.5-flash': 1_000_000,
};

const FALLBACK_MODELS = [
  DEFAULT_VERTEX_MODEL,
  'gemini-1.5-flash-001',
  'gemini-1.5-flash',
  'gemini-1.5-flash-002',
];

const CHARS_PER_TOKEN = 4;
const INPUT_BUDGET_RATIO = 0.7;
const WARNING_RATIO = 0.9;

function normalizeModelName(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

export function resolveVertexModelForLimits(modelName) {
  const normalized = normalizeModelName(modelName);
  if (normalized && MODEL_INPUT_TOKEN_LIMITS[normalized]) {
    return normalized;
  }

  return normalizeModelName(DEFAULT_VERTEX_MODEL);
}

export function getVertexModelInputTokenLimit(modelName) {
  const resolved = resolveVertexModelForLimits(modelName);
  return MODEL_INPUT_TOKEN_LIMITS[resolved] || MODEL_INPUT_TOKEN_LIMITS[normalizeModelName(DEFAULT_VERTEX_MODEL)];
}

export function getDocumentComparisonTextLimits(modelName) {
  const resolvedModel = resolveVertexModelForLimits(modelName);
  const modelInputTokens = getVertexModelInputTokenLimit(resolvedModel);
  const inputTextTokenBudget = Math.max(20_000, Math.floor(modelInputTokens * INPUT_BUDGET_RATIO));
  const totalCharacterLimit = Math.max(80_000, inputTextTokenBudget * CHARS_PER_TOKEN);
  const perDocumentCharacterLimit = Math.floor(totalCharacterLimit / 2);
  const warningCharacterThreshold = Math.floor(perDocumentCharacterLimit * WARNING_RATIO);
  const totalWarningCharacterThreshold = Math.floor(totalCharacterLimit * WARNING_RATIO);

  return {
    model: resolvedModel,
    modelInputTokens,
    inputTextTokenBudget,
    charsPerToken: CHARS_PER_TOKEN,
    warningRatio: WARNING_RATIO,
    totalCharacterLimit,
    perDocumentCharacterLimit,
    warningCharacterThreshold,
    totalWarningCharacterThreshold,
    fallbackModels: [...FALLBACK_MODELS],
  };
}

export function countWords(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return 0;
  }
  return normalized.split(/\s+/g).filter(Boolean).length;
}
