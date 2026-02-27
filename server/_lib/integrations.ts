export type VertexServiceAccountCredentials = {
  type: string;
  project_id: string;
  private_key: string;
  client_email: string;
  token_uri: string;
};

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
    };
  }

  const parseCandidates = [raw];
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    parseCandidates.push(raw.slice(1, -1).trim());
  }

  const strippedWhitespace = raw.replace(/\s+/g, '');
  if (
    /^[A-Za-z0-9+/=]+$/.test(strippedWhitespace) &&
    strippedWhitespace.length % 4 === 0 &&
    strippedWhitespace.length > 64
  ) {
    try {
      const decoded = Buffer.from(strippedWhitespace, 'base64').toString('utf8').trim();
      if (decoded.startsWith('{') && decoded.endsWith('}')) {
        parseCandidates.push(decoded);
      }
    } catch {
      // Ignore invalid base64 variants and continue with other parsing strategies.
    }
  }

  let parsed: Partial<VertexServiceAccountCredentials> | null = null;
  for (const candidate of parseCandidates) {
    try {
      const nextParsed = JSON.parse(candidate) as Partial<VertexServiceAccountCredentials>;
      if (nextParsed && typeof nextParsed === 'object') {
        parsed = nextParsed;
        break;
      }
    } catch {
      // Try the next candidate.
    }
  }

  if (!parsed) {
    return {
      ok: false as const,
      credentials: null,
      serviceAccountJsonPresent: true,
      sourceEnvKey: source?.key || null,
    };
  }

  try {
    const normalizedPrivateKey = asTrimmedString(parsed.private_key)
      .replace(/\r\n/g, '\n')
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n');

    const credentials: VertexServiceAccountCredentials = {
      type: asTrimmedString(parsed.type),
      project_id: asTrimmedString(parsed.project_id),
      private_key: normalizedPrivateKey,
      client_email: asTrimmedString(parsed.client_email),
      token_uri: asTrimmedString(parsed.token_uri || 'https://oauth2.googleapis.com/token'),
    };

    if (
      credentials.type !== 'service_account' ||
      !credentials.project_id ||
      !credentials.private_key ||
      !credentials.client_email ||
      !credentials.token_uri
    ) {
      return {
        ok: false as const,
        credentials: null,
        serviceAccountJsonPresent: true,
        sourceEnvKey: source?.key || null,
      };
    }

    return {
      ok: true as const,
      credentials,
      serviceAccountJsonPresent: true,
      sourceEnvKey: source?.key || null,
    };
  } catch {
    return {
      ok: false as const,
      credentials: null,
      serviceAccountJsonPresent: true,
      sourceEnvKey: source?.key || null,
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

  return {
    vertexConfigured: Boolean(parsed.ok),
    serviceAccountJsonPresent: Boolean(parsed.serviceAccountJsonPresent),
    parsedServiceAccountOk: Boolean(parsed.ok),
    projectIdPresent,
    vertexRegionPresent,
    serviceAccountEnvKey: parsed.sourceEnvKey || null,
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
