import fs from 'fs';
import path from 'path';

/**
 * Resolve the Convex backend URL.
 *
 * Priority:
 * 1. Env var PUBLIC_CONVEX_URL or VITE_CONVEX_URL (CI, cloud deployments)
 * 2. `.convex/.backend-url` file written by vite.config.ts (local dev)
 */
export function resolveConvexUrl(): string | undefined {
	const envUrl = process.env.PUBLIC_CONVEX_URL || process.env.VITE_CONVEX_URL;
	if (envUrl) return envUrl;

	// Local dev: read URL written by vite.config.ts convex-vite-plugin
	const backendUrlFile = path.join(process.cwd(), '.convex', '.backend-url');
	if (fs.existsSync(backendUrlFile)) {
		const url = fs.readFileSync(backendUrlFile, 'utf-8').trim();
		if (url) {
			console.log(`[E2E] Using local Convex backend: ${url}`);
			return url;
		}
	}

	return undefined;
}
