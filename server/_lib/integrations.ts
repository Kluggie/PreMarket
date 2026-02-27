export type VertexServiceAccountCredentials = {
  type: string;
  project_id: string;
  private_key: string;
  client_email: string;
  token_uri: string;
};

export type VertexConfigReasonCode =
  | 'ok'
  | 'missing_service_account_json'
  | 'invalid_service_account_json'
  | 'invalid_service_account_type'
  | 'missing_project_id'
  | 'missing_client_email'
  | 'missing_private_key';

let warnedAboutReplyToApiKey = false;
const VERTEX_SERVICE_ACCOUNT_ENV_KEYS = [
  'GCP_SERVICE_ACCOUNT_JSON',
  'GOOGLE_SERVICE_ACCOUNT_JSON',
  'VERTEX_SERVICE_ACCOUNT_JSON',
] as const;

function asTrimmedString(value: unknown) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

function isLikelyEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizePrivateKey(value: unknown) {
  return asTrimmedString(value)
    .replace(/\r\n/g, '\n')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n');
}

function maybeWrapObjectCandidate(value: string) {
  const trimmed = asTrimmedString(value);
  if (!trimmed) {
    return '';
  }

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  if (!trimmed.includes(':') || !trimmed.includes('"')) {
    return trimmed;
  }

  const body = trimmed.replace(/^\{/, '').replace(/\}$/, '').trim();
  return `{${body}}`;
}

function normalizeJsonCandidate(value: string) {
  return asTrimmedString(value).replace(/,\s*}/g, '}');
}

function repairPrivateKeyCandidate(value: string) {
  const normalized = asTrimmedString(value);
  if (!normalized || !normalized.includes('"private_key"')) {
    return normalized;
  }

  return normalized.replace(
    /("private_key"\s*:\s*")([\s\S]*?)(")(\s*[},])/,
    (_fullMatch, prefix, keyBody, suffixQuote, trailingToken) =>
      `${prefix}${String(keyBody || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\n/g, '\\n')}${suffixQuote}${trailingToken}`,
  );
}

function toConfigReasonMessage(reasonCode: VertexConfigReasonCode) {
  switch (reasonCode) {
    case 'missing_service_account_json':
      return 'Vertex AI integration is not configured: service account env is missing';
    case 'invalid_service_account_json':
      return 'Vertex AI integration is not configured: service account JSON is invalid';
    case 'invalid_service_account_type':
      return 'Vertex AI integration is not configured: service account type must be service_account';
    case 'missing_project_id':
      return 'Vertex AI integration is not configured: service account project_id is missing';
    case 'missing_client_email':
      return 'Vertex AI integration is not configured: service account client_email is missing';
    case 'missing_private_key':
      return 'Vertex AI integration is not configured: service account private_key is missing';
    case 'ok':
    default:
      return '';
  }
}

export function getStripeWebhookSecret() {
  return asTrimmedString(process.env.STRIPE_WEBHOOK_SECRET);
}

export function getResendConfig() {
  const apiKey = asTrimmedString(process.env.RESEND_API_KEY);
  const fromEmail = asTrimmedString(process.env.RESEND_FROM_EMAIL);
  const fromName = asTrimmedString(process.env.RESEND_FROM_NAME);
  const rawReplyTo = asTrimmedString(process.env.RESEND_REPLY_TO);
  const looksLikeApiKey =
    rawReplyTo.length > 0 && rawReplyTo.toLowerCase().startsWith('re_') && !rawReplyTo.includes('@');

  if (looksLikeApiKey && !warnedAboutReplyToApiKey) {
    warnedAboutReplyToApiKey = true;
    console.warn('RESEND_REPLY_TO appears to be an API key; it should be an email address.');
  }

  const replyTo = isLikelyEmail(rawReplyTo) ? rawReplyTo : null;

  return {
    apiKey,
    fromEmail,
    fromName,
    replyTo,
    ready: Boolean(apiKey && fromEmail),
  };
}

export function parseVertexServiceAccountEnv() {
  const source = VERTEX_SERVICE_ACCOUNT_ENV_KEYS.map((key) => ({
    key,
    value: asTrimmedString(process.env[key]),
  })).find((entry) => entry.value.length > 0);
  const raw = source?.value || '';

  if (!raw) {
    return {
      ok: false as const,
      credentials: null,
      serviceAccountJsonPresent: false,
      sourceEnvKey: null,
      reasonCode: 'missing_service_account_json' as VertexConfigReasonCode,
      reasonMessage: toConfigReasonMessage('missing_service_account_json'),
      parseErrorName: null,
      parseErrorMessage: null,
      projectIdPresent: false,
      clientEmailPresent: false,
      privateKeyPresent: false,
    };
  }

  const parseCandidates = new Set<string>([
    normalizeJsonCandidate(raw),
    normalizeJsonCandidate(maybeWrapObjectCandidate(raw)),
  ]);

  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    const unwrapped = raw.slice(1, -1).trim();
    parseCandidates.add(normalizeJsonCandidate(unwrapped));
    parseCandidates.add(normalizeJsonCandidate(maybeWrapObjectCandidate(unwrapped)));
  }

  const strippedWhitespace = raw.replace(/\s+/g, '');
  if (
    /^[A-Za-z0-9+/=]+$/.test(strippedWhitespace) &&
    strippedWhitespace.length % 4 === 0 &&
    strippedWhitespace.length > 64
  ) {
    try {
      const decoded = Buffer.from(strippedWhitespace, 'base64').toString('utf8').trim();
      parseCandidates.add(normalizeJsonCandidate(decoded));
      parseCandidates.add(normalizeJsonCandidate(maybeWrapObjectCandidate(decoded)));
    } catch {
      // Ignore invalid base64 variants and continue with other parsing strategies.
    }
  }

  let parsed: Partial<VertexServiceAccountCredentials> | null = null;
  let parseErrorName = '';
  let parseErrorMessage = '';
  for (const baseCandidate of parseCandidates) {
    const candidate = repairPrivateKeyCandidate(baseCandidate);

    try {
      const nextParsed = JSON.parse(candidate) as Partial<VertexServiceAccountCredentials>;
      if (nextParsed && typeof nextParsed === 'object') {
        parsed = nextParsed;
        break;
      }
    } catch (error: any) {
      parseErrorName = parseErrorName || asTrimmedString(error?.name) || 'SyntaxError';
      parseErrorMessage = parseErrorMessage || asTrimmedString(error?.message) || 'Invalid JSON';
      // Try the next candidate.
    }
  }

  if (!parsed) {
    return {
      ok: false as const,
      credentials: null,
      serviceAccountJsonPresent: true,
      sourceEnvKey: source?.key || null,
      reasonCode: 'invalid_service_account_json' as VertexConfigReasonCode,
      reasonMessage: toConfigReasonMessage('invalid_service_account_json'),
      parseErrorName: parseErrorName || 'SyntaxError',
      parseErrorMessage: parseErrorMessage || 'Invalid JSON',
      projectIdPresent: false,
      clientEmailPresent: false,
      privateKeyPresent: false,
    };
  }

  try {
    const normalizedPrivateKey = normalizePrivateKey(parsed.private_key);
    const projectId = asTrimmedString(parsed.project_id);
    const clientEmail = asTrimmedString(parsed.client_email);
    const type = asTrimmedString(parsed.type);

    const credentials: VertexServiceAccountCredentials = {
      type,
      project_id: projectId,
      private_key: normalizedPrivateKey,
      client_email: clientEmail,
      token_uri: asTrimmedString(parsed.token_uri || 'https://oauth2.googleapis.com/token'),
    };

    const projectIdPresent = Boolean(projectId);
    const clientEmailPresent = Boolean(clientEmail);
    const privateKeyPresent = Boolean(normalizedPrivateKey);
    let reasonCode: VertexConfigReasonCode = 'ok';

    if (credentials.type !== 'service_account') {
      reasonCode = 'invalid_service_account_type';
    } else if (!projectIdPresent) {
      reasonCode = 'missing_project_id';
    } else if (!clientEmailPresent) {
      reasonCode = 'missing_client_email';
    } else if (!privateKeyPresent) {
      reasonCode = 'missing_private_key';
    }

    if (reasonCode !== 'ok' || !credentials.token_uri) {
      return {
        ok: false as const,
        credentials: null,
        serviceAccountJsonPresent: true,
        sourceEnvKey: source?.key || null,
        reasonCode,
        reasonMessage: toConfigReasonMessage(reasonCode),
        parseErrorName: null,
        parseErrorMessage: null,
        projectIdPresent,
        clientEmailPresent,
        privateKeyPresent,
      };
    }

    return {
      ok: true as const,
      credentials,
      serviceAccountJsonPresent: true,
      sourceEnvKey: source?.key || null,
      reasonCode: 'ok' as VertexConfigReasonCode,
      reasonMessage: '',
      parseErrorName: null,
      parseErrorMessage: null,
      projectIdPresent,
      clientEmailPresent,
      privateKeyPresent,
    };
  } catch {
    return {
      ok: false as const,
      credentials: null,
      serviceAccountJsonPresent: true,
      sourceEnvKey: source?.key || null,
      reasonCode: 'invalid_service_account_json' as VertexConfigReasonCode,
      reasonMessage: toConfigReasonMessage('invalid_service_account_json'),
      parseErrorName: 'SyntaxError',
      parseErrorMessage: 'Invalid JSON',
      projectIdPresent: false,
      clientEmailPresent: false,
      privateKeyPresent: false,
    };
  }
}

export function getVertexConfig() {
  const parsed = parseVertexServiceAccountEnv();
  const location = asTrimmedString(process.env.VERTEX_LOCATION) || 'us-central1';
  const model = asTrimmedString(process.env.VERTEX_MODEL) || 'gemini-1.5-flash-002';

  return {
    location,
    model,
    ready: parsed.ok,
    credentials: parsed.credentials,
    configErrorCode: parsed.ok ? null : parsed.reasonCode,
    configErrorMessage: parsed.ok ? null : parsed.reasonMessage,
    sourceEnvKey: parsed.sourceEnvKey || null,
  };
}

export function getVertexConfigSnapshot() {
  const parsed = parseVertexServiceAccountEnv();
  const projectIdPresent = Boolean(
    asTrimmedString(process.env.GCP_PROJECT_ID) ||
      asTrimmedString(parsed.credentials?.project_id),
  );
  const vertexRegionPresent = Boolean(
    asTrimmedString(process.env.GCP_LOCATION) ||
      asTrimmedString(process.env.VERTEX_LOCATION),
  );
  const modelPresent = Boolean(
    asTrimmedString(process.env.VERTEX_MODEL) ||
      asTrimmedString(process.env.VERTEX_COACH_MODEL),
  );

  return {
    vertexConfigured: Boolean(parsed.ok),
    serviceAccountPresent: Boolean(parsed.serviceAccountJsonPresent),
    serviceAccountJsonPresent: Boolean(parsed.serviceAccountJsonPresent),
    serviceAccountParses: Boolean(parsed.ok),
    parsedServiceAccountOk: Boolean(parsed.ok),
    projectIdPresent,
    clientEmailPresent: Boolean(parsed.clientEmailPresent),
    privateKeyPresent: Boolean(parsed.privateKeyPresent),
    regionPresent: vertexRegionPresent,
    vertexRegionPresent,
    modelPresent,
    serviceAccountEnvKey: parsed.sourceEnvKey || null,
    reasonCode: parsed.reasonCode,
    reasonMessage: parsed.reasonMessage || null,
    parseErrorName: parsed.parseErrorName || null,
    parseErrorMessage: parsed.parseErrorMessage || null,
  };
}

export function getVertexNotConfiguredError() {
  const parsed = parseVertexServiceAccountEnv();
  return {
    message: parsed.reasonMessage || 'Vertex AI integration is not configured',
    details: {
      reasonCode: parsed.reasonCode,
      sourceEnvKey: parsed.sourceEnvKey || null,
      parseErrorName: parsed.parseErrorName || null,
      parseErrorMessage: parsed.parseErrorMessage || null,
    },
  };
}

export function getIntegrationsReadiness() {
  const resend = getResendConfig();
  const vertex = getVertexConfigSnapshot();

  return {
    stripeWebhookSecretPresent: Boolean(getStripeWebhookSecret()),
    resendEnvPresent: Boolean(resend.ready),
    vertexCredsPresentAndParsable: Boolean(vertex.parsedServiceAccountOk),
  };
}
