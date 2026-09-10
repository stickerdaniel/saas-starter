import fs from 'fs';
import { normalizeSiteOrigin } from '../../src/lib/config/origin';
import { validateConvexEnvironment } from '../validate-convex-env';
import {
	checkAborted,
	createDeploymentExecution,
	DeploymentError,
	requireCommand,
	throwIfStopped,
	type DeploymentExecution
} from './execution';
import type { PlatformContext } from './platform';
import {
	applyPreviewPrune,
	normalizeIdentifier,
	planPreviewPrune,
	previewManagement,
	type PruneDeps
} from './prune-previews';
import { colors, stripAnsi } from './utils';

export interface ConvexDeployment {
	/** Full URL subdomain including region (e.g., "curious-lark-703.eu-west-1") */
	urlSlug: string | null;
	/** Deployment name only, used for --deployment-name CLI flag (e.g., "curious-lark-703") */
	name: string | null;
}

function convexDeployEnvironment(
	platform: PlatformContext,
	env: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
	const deployEnv = { ...env };
	if (deployEnv.CF_PAGES_BRANCH === '') deployEnv.CF_PAGES_BRANCH = undefined;

	const productionBranch = env.PRODUCTION_BRANCH || 'main';
	if (
		platform.platform === 'cloudflare' &&
		platform.environment === 'production' &&
		!platform.isPreview &&
		platform.gitRef !== null &&
		platform.gitRef === productionBranch
	) {
		if (deployEnv.CF_PAGES) deployEnv.CF_PAGES_BRANCH = 'main';
		if (deployEnv.WORKERS_CI) deployEnv.WORKERS_CI_BRANCH = 'main';
	}

	return deployEnv;
}

/** Sync translations with Tolgee (optional, skipped without TOLGEE_API_KEY). */
export async function syncTranslations(
	platform: PlatformContext,
	execution = createDeploymentExecution()
): Promise<void> {
	checkAborted(execution.signal);
	if (!execution.env.TOLGEE_API_KEY) {
		console.log(
			`${colors.yellow}TOLGEE_API_KEY not set, skipping Tolgee sync (using committed translations)${colors.reset}`
		);
		return;
	}
	const tags =
		platform.environment === 'production'
			? ['--tag', 'production', '--untag', 'preview']
			: platform.isPreview
				? ['--tag', 'preview']
				: null;
	if (tags) {
		console.log(`Tagging ${platform.environment} keys...`);
		requireCommand(
			await execution.run({
				command: 'tolgee',
				args: ['tag', '--filter-extracted', ...tags],
				output: 'inherit'
			}),
			'Tolgee tagging failed.'
		);
	} else {
		console.log(`${colors.yellow}Unknown environment, skipping tagging${colors.reset}`);
	}
	console.log('Pulling latest translations...');
	requireCommand(
		await execution.run({ command: 'tolgee', args: ['pull'], output: 'inherit' }),
		'Tolgee pull failed.'
	);
}

/** Production owns its capability profile before pre-deployment validation. */
export async function setProductionCapabilityProfile(
	platform: PlatformContext,
	execution = createDeploymentExecution()
): Promise<void> {
	if (platform.environment !== 'production' || platform.isPreview) return;
	console.log('Setting Convex capability profile to production...');
	requireCommand(
		await execution.run({
			command: 'bunx',
			args: ['convex', 'env', 'set', 'CAPABILITY_PROFILE', 'production', '--prod'],
			output: 'inherit'
		}),
		'Failed to set the production capability profile.'
	);
}

/** Validate in-process: no nested CLI/runner process group or second logging boundary. */
export async function validateConvexEnv(
	platform: PlatformContext,
	deployment?: ConvexDeployment,
	execution = createDeploymentExecution()
): Promise<void> {
	checkAborted(execution.signal);
	if (platform.environment === 'production') {
		console.log('Checking required Convex environment variables (production)...');
		await validateConvexEnvironment(['--prod'], 'production', execution);
	} else if (platform.isPreview && deployment?.name) {
		console.log('Checking required Convex environment variables (preview)...');
		await validateConvexEnvironment(['--deployment-name', deployment.name], 'preview', execution);
	} else if (!platform.isPreview) {
		console.log(
			`${colors.yellow}Unknown environment: ${platform.environment}, skipping env var check${colors.reset}`
		);
	}
}

const MAX_RECOVERY_ATTEMPTS = 3;
const POST_PRUNE_DELAY_MS = 10_000;

/** A failed or partially unparseable remote listing must never authorize deletion. */
async function fetchLiveBranches(execution: DeploymentExecution): Promise<Set<string> | null> {
	const result = await execution.run({ command: 'git', args: ['ls-remote', '--heads', 'origin'] });
	throwIfStopped(result);
	if (!result.ok) return null;
	const live = new Set<string>();
	for (const line of result.stdout.trim().split('\n')) {
		if (!line) continue;
		const branch = line.match(/^(?:[0-9a-f]{40}|[0-9a-f]{64})\s+refs\/heads\/(.+)$/)?.[1];
		if (!branch || !normalizeIdentifier(branch)) return null;
		live.add(normalizeIdentifier(branch));
	}
	return live;
}

export interface PreviewRecovery {
	management?: PruneDeps;
	now?: () => number;
	protectedBranches?: ReadonlySet<string>;
	protectedDeployments?: ReadonlySet<string>;
	currentDeployment?: string | null;
}

/** Deploy once; only a preview quota error can authorize up to three prune/retry rounds. */
export async function deployConvex(
	platform: PlatformContext,
	execution = createDeploymentExecution(),
	recovery: PreviewRecovery = {}
): Promise<ConvexDeployment> {
	checkAborted(execution.signal);
	const args = ['convex', 'deploy'];
	if (platform.isPreview) {
		const previewKey = execution.env.CONVEX_PREVIEW_DEPLOY_KEY;
		if (previewKey) {
			execution.env.CONVEX_DEPLOY_KEY = previewKey;
			console.log('Using Convex preview deploy key');
		} else if (execution.env.CONVEX_DEPLOY_KEY) {
			throw new DeploymentError(
				'configuration',
				'CONVEX_PREVIEW_DEPLOY_KEY not set for preview build — would deploy to production. Aborting.'
			);
		}
		if (platform.gitRef) args.push('--preview-create', platform.gitRef);
	}
	const token = execution.env.CONVEX_MANAGEMENT_TOKEN;
	const projectId = execution.env.CONVEX_PROJECT_ID;
	const management = recovery.management ?? previewManagement;
	console.log('Deploying Convex functions...');
	const { result } = await execution.retry(
		{
			command: 'bunx',
			args,
			output: 'capture',
			env: convexDeployEnvironment(platform, execution.env)
		},
		{
			// Includes the initial deployment; there is no extra execution on exhaustion.
			maxAttempts: MAX_RECOVERY_ATTEMPTS + 1,
			delay: { kind: 'fixed', delayMs: POST_PRUNE_DELAY_MS },
			shouldRetry: (failure) =>
				platform.isPreview &&
				!!token &&
				!!projectId &&
				failure.kind === 'non_zero_exit' &&
				/DeploymentQuotaReached/.test(stripAnsi(failure.stdout + '\n' + failure.stderr)),
			onFailedAttempt: async ({ attempt, willRetry }) => {
				if (!willRetry || !token || !projectId) return;
				checkAborted(execution.signal);
				// Re-read both snapshots before every round; don't keep deleting from a stale list.
				const liveBranches = await fetchLiveBranches(execution);
				if (liveBranches === null) {
					throw new DeploymentError(
						'prune_blocked',
						'Preview quota recovery blocked: live branches are unknown.'
					);
				}
				const previews = await management.list(token, projectId, execution);
				const plan = planPreviewPrune({
					projectId,
					previews,
					currentBranch: platform.gitRef,
					currentDeployment: recovery.currentDeployment,
					liveBranches,
					protectedBranches: new Set([
						execution.env.PRODUCTION_BRANCH || 'main',
						...(recovery.protectedBranches ?? [])
					]),
					protectedDeployments: recovery.protectedDeployments,
					now: (recovery.now ?? Date.now)()
				});
				if (plan.kind === 'no_candidate') {
					throw new DeploymentError(
						'prune_blocked',
						`Preview quota recovery blocked: ${plan.reason}.`
					);
				}
				const applied = await applyPreviewPrune(plan, {
					token,
					projectId,
					remove: management.remove,
					signal: execution.signal,
					timeoutMs: execution.timeoutMs
				});
				console.log(`[${attempt}/${MAX_RECOVERY_ATTEMPTS}] Pruned preview: ${applied.pruned}`);
				console.log(`Waiting ${POST_PRUNE_DELAY_MS / 1000}s for Convex quota propagation...`);
			}
		}
	);
	requireCommand(result, 'Convex deployment failed.');
	const combined = stripAnsi(result.stdout + '\n' + result.stderr);
	const match = combined.match(/https:\/\/(([a-z0-9-]+)(?:\.[a-z0-9-]+)*)\.convex\.cloud/);
	const urlSlug = match?.[1] ?? null;
	const name = match?.[2] ?? null;
	if (name) {
		console.log(`Detected Convex deployment: ${name}`);
		if (urlSlug !== name) console.log(`  Regional URL: ${urlSlug}.convex.cloud`);
	} else {
		console.warn(
			`${colors.yellow}Warning: Could not parse deployment URL from convex deploy output${colors.reset}`
		);
	}
	return { urlSlug, name };
}

/** Set SITE_URL, verify it, validate required values, then seed the preview admin. */
export async function setupPreviewEnv(
	deployment: ConvexDeployment,
	platform: PlatformContext,
	execution = createDeploymentExecution()
): Promise<void> {
	checkAborted(execution.signal);
	if (!deployment.name)
		throw new DeploymentError(
			'configuration',
			'Could not detect Convex deployment name. Cannot set SITE_URL.'
		);
	if (!platform.siteUrl)
		throw new DeploymentError(
			'configuration',
			'Site URL is not available. Cannot set SITE_URL for preview.'
		);
	const previewSiteUrl = platform.siteUrl;
	requireCommand(
		await execution.run({
			command: 'bunx',
			args: [
				'convex',
				'env',
				'set',
				'--deployment-name',
				deployment.name,
				'CAPABILITY_PROFILE',
				'preview'
			]
		}),
		'Failed to set the preview capability profile.'
	);
	console.log(`Setting SITE_URL for preview: ${previewSiteUrl}`);
	const { result: setResult } = await execution.retry(
		{
			command: 'bunx',
			args: [
				'convex',
				'env',
				'set',
				'--deployment-name',
				deployment.name,
				'SITE_URL',
				previewSiteUrl
			]
		},
		{
			maxAttempts: 5,
			delay: { kind: 'fixed', delayMs: 5000 },
			shouldRetry: () => true,
			onFailedAttempt: ({ attempt, maxAttempts, willRetry }) => {
				if (willRetry)
					console.log(
						`[Attempt ${attempt}/${maxAttempts}] convex env set SITE_URL failed; retrying in 5s...`
					);
			}
		}
	);
	requireCommand(setResult, 'Failed to set SITE_URL for preview after all attempts.');
	console.log(`${colors.green}SITE_URL set successfully${colors.reset}`);
	console.log('Verifying SITE_URL was set correctly...');
	const listResult = await execution.run({
		command: 'bunx',
		args: ['convex', 'env', 'list', '--deployment-name', deployment.name],
		output: 'capture'
	});
	throwIfStopped(listResult);
	if (listResult.ok) {
		const actualSiteUrl = listResult.stdout.match(/^SITE_URL=(.+)$/m)?.[1];
		if (actualSiteUrl) {
			if (actualSiteUrl !== previewSiteUrl)
				throw new DeploymentError('configuration', 'SITE_URL mismatch in preview environment.');
			console.log(`${colors.green}SITE_URL verified: ${previewSiteUrl}${colors.reset}`);
		} else {
			console.warn(
				`${colors.yellow}Warning: Could not find SITE_URL in env list output${colors.reset}`
			);
		}
	} else {
		console.warn(
			`${colors.yellow}Warning: Could not verify SITE_URL (env list failed)${colors.reset}`
		);
	}
	await validateConvexEnv(platform, deployment, execution);
	// Runtime preview defaults remain the sole source of the admin password.
	console.log('Seeding preview admin user...');
	const seedResult = await execution.run({
		command: 'bunx',
		args: ['convex', 'run', '--deployment-name', deployment.name, 'previewDev:ensurePreviewAdmin']
	});
	throwIfStopped(seedResult);
	if (seedResult.ok) {
		console.log(`${colors.green}=== Preview Admin Seeded ===${colors.reset}`);
		console.log('  Email:    admin@preview.dev');
		console.log('  Password: (PREVIEW_ADMIN_PASSWORD)');
	} else {
		console.warn(
			`${colors.yellow}Warning: Preview admin seeding failed (non-blocking). Set PREVIEW_ADMIN_PASSWORD as a Convex preview default env var (bunx convex env default set --type preview).${colors.reset}`
		);
	}
}

/** Write E2E config for preview deployments. */
export function writeE2eConfig(
	platform: PlatformContext,
	buildEnv: Record<string, string | undefined>
): void {
	if (!platform.isPreview || !buildEnv.PUBLIC_CONVEX_URL) return;
	const e2eConfig = {
		convexUrl: buildEnv.PUBLIC_CONVEX_URL,
		convexSiteUrl: buildEnv.PUBLIC_CONVEX_SITE_URL,
		generatedAt: new Date().toISOString()
	};
	const configDir = 'static/.well-known';
	const configPath = `${configDir}/e2e-config.json`;
	if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
	fs.writeFileSync(configPath, JSON.stringify(e2eConfig, null, 2));
	console.log(`${colors.green}E2E config written to ${configPath}${colors.reset}`);
}

/** Resolve the canonical origin before deployment mutates any remote service. */
export function resolveDeploymentSiteOrigin(
	platform: PlatformContext,
	env: NodeJS.ProcessEnv = process.env
): string {
	if (platform.isPreview) {
		if (!platform.siteUrl) {
			throw new DeploymentError(
				'configuration',
				'Preview builds require a platform preview URL for canonical metadata.'
			);
		}
		return normalizeSiteOrigin(platform.siteUrl);
	}

	const publicSiteUrl = env.PUBLIC_SITE_URL ? normalizeSiteOrigin(env.PUBLIC_SITE_URL) : undefined;
	const siteUrl = env.SITE_URL ? normalizeSiteOrigin(env.SITE_URL) : undefined;
	if (publicSiteUrl && siteUrl && publicSiteUrl !== siteUrl) {
		throw new DeploymentError(
			'configuration',
			`PUBLIC_SITE_URL (${publicSiteUrl}) conflicts with SITE_URL (${siteUrl}).`
		);
	}
	const origin =
		publicSiteUrl ??
		siteUrl ??
		(platform.siteUrl ? normalizeSiteOrigin(platform.siteUrl) : undefined);
	if (!origin) {
		throw new DeploymentError(
			'configuration',
			'Production builds require PUBLIC_SITE_URL, SITE_URL, or a platform URL.'
		);
	}
	return origin;
}

/** Compute build environment without changing the invocation's runtime environment. */
export function computeBuildEnv(
	platform: PlatformContext,
	deployment: ConvexDeployment,
	env: NodeJS.ProcessEnv = process.env,
	siteOrigin = resolveDeploymentSiteOrigin(platform, env)
): Record<string, string | undefined> {
	const buildEnv: Record<string, string | undefined> = { ...env };
	delete buildEnv.__VARLOCK_ENV;
	let deploymentUrlSlug = deployment.urlSlug;
	if (!deploymentUrlSlug) {
		const convexDeployKey = env.CONVEX_DEPLOY_KEY;
		if (convexDeployKey) {
			const parts = convexDeployKey.split('|');
			if (parts.length >= 2) {
				const keyParts = (parts[0] ?? '').split(':');
				const name = keyParts[keyParts.length - 1] ?? null;
				deploymentUrlSlug = name;
			}
		}
	}
	if (deploymentUrlSlug) {
		buildEnv.PUBLIC_CONVEX_URL = `https://${deploymentUrlSlug}.convex.cloud`;
		buildEnv.PUBLIC_CONVEX_SITE_URL = `https://${deploymentUrlSlug}.convex.site`;
		console.log(`PUBLIC_CONVEX_URL: ${buildEnv.PUBLIC_CONVEX_URL}`);
		console.log(`PUBLIC_CONVEX_SITE_URL: ${buildEnv.PUBLIC_CONVEX_SITE_URL}`);
	} else {
		console.warn(
			`${colors.yellow}Warning: Could not determine Convex deployment URL${colors.reset}`
		);
	}
	if (platform.isPreview) {
		buildEnv.SITE_URL = siteOrigin;
		buildEnv.PUBLIC_SITE_URL = siteOrigin;
		console.log(`SITE_URL (for SvelteKit build): ${siteOrigin}`);
		console.log(`PUBLIC_SITE_URL (for SvelteKit build): ${siteOrigin}`);
	} else {
		buildEnv.PUBLIC_SITE_URL = siteOrigin;
		console.log(`PUBLIC_SITE_URL (for SvelteKit build): ${siteOrigin}`);
	}
	return buildEnv;
}

export async function buildSvelteKit(
	buildEnv: Record<string, string | undefined>,
	execution = createDeploymentExecution()
): Promise<void> {
	console.log('Building SvelteKit...');
	requireCommand(
		await execution.run({
			command: 'bun',
			args: ['run', 'build'],
			env: { ...buildEnv, __VARLOCK_ENV: undefined },
			output: 'inherit'
		}),
		'SvelteKit build failed.'
	);
}
