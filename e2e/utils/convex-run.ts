/**
 * Helper to call internal Convex functions from E2E tests via `bunx convex run`.
 *
 * Since test functions are now internalMutation/internalQuery, they cannot be
 * called via ConvexHttpClient. Instead we shell out to `bunx convex run`.
 */

import { execSync } from 'child_process';

/**
 * Run an internal Convex function and return the parsed result.
 *
 * @param functionPath - e.g. "tests:verifyTestUserEmail"
 * @param args - Plain object that will be JSON-serialised
 * @returns Parsed JSON output from the function
 */
export function convexRun<T = unknown>(
	functionPath: string,
	args: Record<string, unknown> = {}
): T {
	const argsJson = JSON.stringify(args);
	// Use --url flag with PUBLIC_CONVEX_URL to target the correct deployment
	const convexUrl = process.env.PUBLIC_CONVEX_URL || process.env.VITE_CONVEX_URL;
	const urlFlag = convexUrl ? ` --url ${convexUrl}` : '';
	const cmd = `bunx convex run ${functionPath} '${argsJson}'${urlFlag}`;

	try {
		const stdout = execSync(cmd, {
			encoding: 'utf-8',
			timeout: 120_000,
			// Inherit env so CONVEX_DEPLOY_KEY etc. are available
			env: { ...process.env },
			cwd: process.cwd()
		});

		// `convex run` prints the return value as JSON on the last non-empty line.
		// Earlier lines may contain log output or warnings.
		const lines = stdout.trim().split('\n');
		const lastLine = lines[lines.length - 1].trim();

		// If the last line looks like JSON, parse it; otherwise return as-is
		try {
			return JSON.parse(lastLine) as T;
		} catch {
			// Some functions return simple scalars or null
			return lastLine as unknown as T;
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`convex run ${functionPath} failed: ${message}`);
	}
}
