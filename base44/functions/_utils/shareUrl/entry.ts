/**
 * Centralized URL construction for share links
 * Enforces use of APP_BASE_URL only - no runtime/request-derived origins
 */

export const SHARE_REPORT_PATH = '/SharedReport';

/**
 * Get the public base URL (APP_BASE_URL from environment)
 * @throws {Error} if APP_BASE_URL is not set
 * @returns {string} Base URL (e.g., "https://getpremarket.com")
 */
export function getPublicBaseUrl(): string {
  const baseUrl = Deno.env.get('APP_BASE_URL');
  
  if (!baseUrl) {
    throw new Error('APP_BASE_URL environment variable is not set');
  }
  
  // Validate it doesn't contain deno.dev or base44.app
  if (baseUrl.includes('deno.dev') || baseUrl.includes('base44.app')) {
    throw new Error(`APP_BASE_URL contains non-production domain: ${baseUrl}`);
  }
  
  return baseUrl.replace(/\/$/, ''); // Remove trailing slash if present
}

/**
 * Build a shared report URL with the given token
 * @param {string} token - The share link token
 * @returns {string} Full URL to shared report page
 */
export function buildSharedReportUrl(token: string, extraQueryParams?: Record<string, string | null | undefined>): string {
  if (!token) {
    throw new Error('Token is required to build share URL');
  }
  
  const baseUrl = getPublicBaseUrl();
  const query = new URLSearchParams({ token });
  if (extraQueryParams) {
    for (const [key, value] of Object.entries(extraQueryParams)) {
      if (value === null || value === undefined) continue;
      const normalized = String(value).trim();
      if (!normalized) continue;
      query.set(key, normalized);
    }
  }
  return `${baseUrl}${SHARE_REPORT_PATH}?${query.toString()}`;
}

/**
 * Validate a share URL before sending in email
 * @param {string} url - The URL to validate
 * @throws {Error} if URL doesn't use getpremarket.com
 */
export function validateShareUrl(url: string): void {
  if (!url) {
    throw new Error('Share URL is empty');
  }
  
  if (!url.startsWith('https://getpremarket.com/')) {
    throw new Error(`Share URL must start with https://getpremarket.com/, got: ${url}`);
  }
  
  // Additional check for deno.dev or base44.app
  if (url.includes('deno.dev') || url.includes('base44.app')) {
    throw new Error(`Share URL contains non-production domain: ${url}`);
  }

  const parsed = new URL(url);
  if (parsed.pathname !== SHARE_REPORT_PATH) {
    throw new Error(`Share URL path must be ${SHARE_REPORT_PATH}, got: ${parsed.pathname}`);
  }
}
