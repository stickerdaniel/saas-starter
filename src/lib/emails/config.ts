import { env } from '$env/dynamic/public';

/**
 * Base URL for email images and links.
 * - Empty string for previews (relative URLs work in browser)
 * - Set PUBLIC_PROD_URL to production domain for sending real emails
 */
export const emailBaseUrl = env.PUBLIC_PROD_URL || '';
