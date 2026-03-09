export class ApiError extends Error {
  constructor(statusCode, code, message, extra = {}) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.extra = extra;
  }
}

/**
 * Postgres error codes we handle specially.
 *
 * 42P01  undefined_table   — migration has not been applied yet; the table the
 *                            route needs literally doesn't exist.
 * 42000  syntax_error_or_access_rule_violation — broad class for schema issues.
 * 08xxx  connection errors — DB is not reachable (pooler down, URL wrong, etc.)
 * 57xxx  operator intervention — DB was shut down / SIGTERM'd
 * 3D000  invalid_catalog_name — wrong database name in the URL
 */
const PG_UNDEFINED_TABLE = '42P01';
const PG_UNDEFINED_COLUMN = '42703';
const PG_UNDEFINED_OBJECT = '42704';
const PG_CONNECTION_PREFIXES = ['08', '57', '3D'];

function pgCode(error) {
  // @neondatabase/serverless and pg both attach .code to the error object.
  return typeof error?.code === 'string' ? error.code : null;
}

function isSchemaError(code) {
  return code === PG_UNDEFINED_TABLE || code === PG_UNDEFINED_COLUMN || code === PG_UNDEFINED_OBJECT;
}

function isConnectionError(code) {
  if (!code) return false;
  return PG_CONNECTION_PREFIXES.some((prefix) => code.startsWith(prefix));
}

/**
 * Returns a structured ApiError for any thrown value.
 *
 * DB-level errors that indicate a missing schema (table/column undefined)
 * are returned as 503 db_schema_missing — this is the canonical signal that
 * a Drizzle migration has not been applied to the deployment's database.
 *
 * DB connection failures return 503 db_unavailable.
 *
 * All other unexpected errors return the standard 500 internal_error.
 */
export function toApiError(error) {
  if (error instanceof ApiError) {
    return error;
  }

  const code = pgCode(error);

  if (isSchemaError(code)) {
    // Log the full message server-side so operators can identify the missing table.
    console.error(
      JSON.stringify({
        level: 'error',
        source: 'toApiError',
        message: 'DB schema error — a migration has likely not been applied to this database.',
        pgCode: code,
        pgMessage: String(error?.message || ''),
        hint: 'Run "npm run db:migrate" against the target database, or ensure the vercel-build script includes db:migrate.',
      }),
    );
    return new ApiError(
      503,
      'db_schema_missing',
      'A required database table or column is missing. A migration may not have been applied to this environment.',
    );
  }

  if (isConnectionError(code)) {
    console.error(
      JSON.stringify({
        level: 'error',
        source: 'toApiError',
        message: 'DB connection error — the database is not reachable.',
        pgCode: code,
        pgMessage: String(error?.message || ''),
        hint: 'Verify DATABASE_URL is correct and the Neon project is active.',
      }),
    );
    return new ApiError(
      503,
      'db_unavailable',
      'The database is not reachable. Check DATABASE_URL and the Neon project status.',
    );
  }

  return new ApiError(500, 'internal_error', 'Unexpected server error');
}
