/**
 * Centralized URL construction for share links
 * Enforces use of APP_BASE_URL only - no runtime/request-derived origins
 */

/**
 * Get the public base URL (APP_BASE_URL from environment)
 * @throws {Error} if APP_BASE_URL is not set
 * @returns {string} Base URL (e.g., "https://getpremarket.com")
 */
export function getPublicBaseUrl() {
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
export function buildSharedReportUrl(token) {
  if (!token) {
    throw new Error('Token is required to build share URL');
  }
  
  const baseUrl = getPublicBaseUrl();
  return `${baseUrl}/shared-report?token=${token}`;
}

/**
 * Validate a share URL before sending in email
 * @param {string} url - The URL to validate
 * @throws {Error} if URL doesn't use getpremarket.com
 */
export function validateShareUrl(url) {
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
}