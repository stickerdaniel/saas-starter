import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export const MANAGED_LOCAL_PROVIDER_KEYS = [
	'RESEND_API_KEY',
	'AUTH_EMAIL',
	'EMAIL_ASSET_URL',
	'AUTUMN_SECRET_KEY',
	'OPENROUTER_API_KEY'
] as const;

/**
 * Synchronize only provider values whose absence means deliberate local removal.
 * Other backend values persist when omitted from `.env.convex.local`.
 */
export function getManagedProviderUpdates(
	environment: Readonly<Record<string, string>>
): Record<(typeof MANAGED_LOCAL_PROVIDER_KEYS)[number], string | null> {
	return Object.fromEntries(
		MANAGED_LOCAL_PROVIDER_KEYS.map((key) => [key, environment[key] ?? null])
	) as Record<(typeof MANAGED_LOCAL_PROVIDER_KEYS)[number], string | null>;
}

/**
 * The origin of a developer-supplied URL, for logging.
 *
 * `.env.convex.local` holds secrets, and a URL a developer typed can carry
 * userinfo or a query token. Such a value reaches the console only in the
 * warning about an ignored `SITE_URL`, so it is reduced to scheme, host and
 * port: enough to say which stale value is ignored, without the
 * credential-bearing parts.
 */
export function logSafeOrigin(value: string): string {
	try {
		return new URL(value).origin;
	} catch {
		return '<unparseable>';
	}
}

export function computeLocalConvexStateId(projectDir: string, suffix?: string): string {
	const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
		cwd: projectDir,
		encoding: 'utf-8',
		stdio: ['ignore', 'pipe', 'pipe']
	});
	const gitBranch = result.status === 0 && result.stdout ? result.stdout.trim() : 'unknown';
	const input = suffix ? `${gitBranch}:${projectDir}:${suffix}` : `${gitBranch}:${projectDir}`;
	const hash = createHash('sha256').update(input).digest('hex').slice(0, 16);
	const sanitizedBranch = gitBranch.replace(/[^a-zA-Z0-9-]/g, '-');
	const sanitizedSuffix = suffix ? `-${suffix.replace(/[^a-zA-Z0-9-]/g, '-')}` : '';
	return `${sanitizedBranch}${sanitizedSuffix}-${hash}`;
}

export type LocalConvexMode = 'dev' | 'dev:test';

export function localConvexMode(env: NodeJS.ProcessEnv): LocalConvexMode | undefined {
	const lifecycle = env.npm_lifecycle_event;
	return (lifecycle === 'dev' || lifecycle === 'dev:test') && !env.CI ? lifecycle : undefined;
}
