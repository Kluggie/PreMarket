export type VertexServiceAccountCredentials = {
  type: string;
  project_id: string;
  private_key: string;
  client_email: string;
  token_uri: string;
};

function asTrimmedString(value: unknown) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

export function getStripeWebhookSecret() {
  return asTrimmedString(process.env.STRIPE_WEBHOOK_SECRET);
}

export function getResendConfig() {
  const apiKey = asTrimmedString(process.env.RESEND_API_KEY);
  const fromEmail = asTrimmedString(process.env.RESEND_FROM_EMAIL);
  const fromName = asTrimmedString(process.env.RESEND_FROM_NAME);
  const replyTo = asTrimmedString(process.env.RESEND_REPLY_TO) || null;

  return {
    apiKey,
    fromEmail,
    fromName,
    replyTo,
    ready: Boolean(apiKey && fromEmail),
  };
}

export function parseVertexServiceAccountEnv() {
  const raw = asTrimmedString(process.env.GCP_SERVICE_ACCOUNT_JSON);

  if (!raw) {
    return {
      ok: false as const,
      credentials: null,
    };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<VertexServiceAccountCredentials>;

    const credentials: VertexServiceAccountCredentials = {
      type: asTrimmedString(parsed.type),
      project_id: asTrimmedString(parsed.project_id),
      private_key: asTrimmedString(parsed.private_key),
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
      };
    }

    return {
      ok: true as const,
      credentials,
    };
  } catch {
    return {
      ok: false as const,
      credentials: null,
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

export function getIntegrationsReadiness() {
  const resend = getResendConfig();
  const vertex = parseVertexServiceAccountEnv();

  return {
    stripeWebhookSecretPresent: Boolean(getStripeWebhookSecret()),
    resendEnvPresent: Boolean(resend.ready),
    vertexCredsPresentAndParsable: Boolean(vertex.ok),
  };
}
