/**
 * Type declarations for SvelteKit environment variables
 * This allows the library to be used without a dev server
 */

declare module '$env/static/public' {
	export const PUBLIC_CONVEX_URL: string;
}
