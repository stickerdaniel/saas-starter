import fs from 'fs';
import type { PlatformContext } from './platform';
import { pruneOldestPreview } from './prune-previews';
import {
	colors,
	runCommand,
	runCommandCapture,
	runCommandWithRetry,
	sleep,
	stripAnsi
} from './utils';

export interface ConvexDeployment {
	/** Full URL subdomain including region (e.g., "curious-lark-703.eu-west-1") */
	urlSlug: string | null;
	/** Deployment name only, used for --deployment-name CLI flag (e.g., "curious-lark-703") */
	name: string | null;
}

/**
 * Sync translations with Tolgee (optional, skipped without TOLGEE_API_KEY)
 */
export function syncTranslations(platform: PlatformContext): void {
	const tolgeeApiKey = process.env.TOLGEE_API_KEY;

	if (!tolgeeApiKey) {
		console.log(
			`${colors.yellow}TOLGEE_API_KEY not set, skipping Tolgee sync (using committed translations)${colors.reset}`
		);
		return;
	}

	if (platform.environment === 'production') {
		console.log('Tagging production keys...');
		if (
			!runCommand('tolgee', [
				'tag',
				'--filter-extracted',
				'--tag',
				'production',
				'--untag',
				'preview'
			])
		) {
			console.error(`${colors.red}Tolgee tagging failed${colors.reset}`);
			process.exit(1);
		}
	} else if (platform.isPreview) {
		console.log('Tagging preview keys...');
		if (!runCommand('tolgee', ['tag', '--filter-extracted', '--tag', 'preview'])) {
			console.error(`${colors.red}Tolgee tagging failed${colors.reset}`);
			process.exit(1);
		}
	} else {
		console.log(`${colors.yellow}Unknown environment, skipping tagging${colors.reset}`);
	}

	console.log('Pulling latest translations...');
	if (!runCommand('tolgee', ['pull'])) {
		console.error(`${colors.red}Tolgee pull failed${colors.reset}`);
		process.exit(1);
	}
}

/**
 * Validate required Convex environment variables
 */
export function validateConvexEnv(platform: PlatformContext, deployment?: ConvexDeployment): void {
	if (platform.environment === 'production') {
		console.log('Checking required Convex environment variables (production)...');
		if (!runCommand('bun', ['scripts/validate-convex-env.ts', '--prod'])) {
			console.error(`${colors.red}Environment variable validation failed${colors.reset}`);
			process.exit(1);
		}
	} else if (platform.isPreview && deployment?.name) {
		console.log('Checking required Convex environment variables (preview)...');
		if (
			!runCommand('bun', ['scripts/validate-convex-env.ts', '--deployment-name', deployment.name])
		) {
			console.error(`${colors.red}Environment variable validation failed${colors.reset}`);
			process.exit(1);
		}
	} else if (!platform.isPreview && platform.environment !== 'production') {
		console.log(
			`${colors.yellow}Unknown environment: ${platform.environment}, skipping env var check${colors.reset}`
		);
	}
}

/**
 * Deploy Convex functions and parse the deployment URL from output.
 * For preview builds, swaps to a preview deploy key if CONVEX_PREVIEW_DEPLOY_KEY is set.
 */
export async function deployConvex(platform: PlatformContext): Promise<ConvexDeployment> {
	const args = ['convex', 'deploy'];

	if (platform.isPreview) {
		const previewKey = process.env.CONVEX_PREVIEW_DEPLOY_KEY;
		if (previewKey) {
			// Set on process.env so all subsequent Convex CLI commands
			// (env set, run) in setupPreviewEnv() also use the preview key
			process.env.CONVEX_DEPLOY_KEY = previewKey;
			console.log('Using Convex preview deploy key');
		} else if (process.env.CONVEX_DEPLOY_KEY) {
			console.error(
				`${colors.red}CONVEX_PREVIEW_DEPLOY_KEY not set for preview build — would deploy to production. Aborting.${colors.reset}`
			);
			process.exit(1);
		}
		// CF Workers Builds isn't in Convex's auto-detection list for --preview-create,
		// so pass the branch name explicitly
		if (platform.gitRef) {
			args.push('--preview-create', platform.gitRef);
		}
	}

	console.log('Deploying Convex functions...');
	let result = runCommandCapture('bunx', args);

	if (result.stdout) console.log(result.stdout);
	if (result.stderr) console.error(result.stderr);

	if (!result.success) {
		const combined = stripAnsi(result.stdout + '\n' + result.stderr);
		const quotaHit = platform.isPreview && /DeploymentQuotaReached/.test(combined);

		if (quotaHit) {
			const retried = await tryRecoverFromQuota(platform, args);
			if (retried) {
				result = retried;
			}
		}

		if (!result.success) {
			console.error(`${colors.red}Convex deployment failed${colors.reset}`);
			process.exit(1);
		}
	}

	// Extract deployment URL from output
	// Supports both standard (xxx.convex.cloud) and regional (xxx.eu-west-1.convex.cloud) URLs
	const combinedOutput = stripAnsi(result.stdout + '\n' + result.stderr);
	const deployUrlMatch = combinedOutput.match(
		/https:\/\/(([a-z0-9-]+)(?:\.[a-z0-9-]+)*)\.convex\.cloud/
	);

	const urlSlug = deployUrlMatch ? deployUrlMatch[1] : null;
	const name = deployUrlMatch ? deployUrlMatch[2] : null;

	if (name) {
		console.log(`Detected Convex deployment: ${name}`);
		if (urlSlug !== name) {
			console.log(`  Regional URL: ${urlSlug}.convex.cloud`);
		}
	} else {
		console.warn(
			`${colors.yellow}Warning: Could not parse deployment URL from convex deploy output${colors.reset}`
		);
	}

	return { urlSlug, name };
}

// Adaptive recovery parameters. Convex's team quota covers all deployment
// types (dev + preview + prod), and the `claim_preview_deployment` quota
// check is eventually consistent with deletes. So we prune one preview,
// wait for propagation, retry, and only prune again if the retry still
// hits the same quota error — not on any other failure.
const MAX_RECOVERY_ATTEMPTS = 3;
const POST_PRUNE_DELAY_MS = 10_000;

/**
 * On DeploymentQuotaReached: adaptively prune one eligible preview per
 * attempt, wait for quota propagation, and retry `convex deploy`. Stops
 * early if one prune is enough. Bounded at MAX_RECOVERY_ATTEMPTS deletes
 * and retries. Opt-in via CONVEX_MANAGEMENT_TOKEN + CONVEX_PROJECT_ID —
 * if either is unset, returns null so the caller exits with the original
 * error.
 */
async function tryRecoverFromQuota(
	platform: PlatformContext,
	args: string[]
): Promise<{ success: boolean; stdout: string; stderr: string } | null> {
	const token = process.env.CONVEX_MANAGEMENT_TOKEN;
	const projectId = process.env.CONVEX_PROJECT_ID;

	if (!token || !projectId) {
		console.error(
			`${colors.yellow}Prune fallback not configured (CONVEX_MANAGEMENT_TOKEN / CONVEX_PROJECT_ID unset)${colors.reset}`
		);
		return null;
	}

	console.log(
		`${colors.yellow}DeploymentQuotaReached detected. Adaptive recovery (up to ${MAX_RECOVERY_ATTEMPTS} prune+retry rounds)...${colors.reset}`
	);

	let lastResult: { success: boolean; stdout: string; stderr: string } | null = null;

	for (let attempt = 1; attempt <= MAX_RECOVERY_ATTEMPTS; attempt++) {
		const pruneResult = await pruneOldestPreview({
			token,
			projectId,
			currentBranch: platform.gitRef ?? null
		});
		if (pruneResult.pruned === null) {
			console.error(
				`${colors.red}Prune fallback ran out of candidates on attempt ${attempt}: ${pruneResult.reason}${colors.reset}`
			);
			return lastResult;
		}
		console.log(
			`${colors.green}[${attempt}/${MAX_RECOVERY_ATTEMPTS}] Pruned preview: ${pruneResult.pruned}${colors.reset}`
		);

		console.log(`  Waiting ${POST_PRUNE_DELAY_MS / 1000}s for Convex quota propagation...`);
		await sleep(POST_PRUNE_DELAY_MS);

		console.log(`  Retrying deploy...`);
		lastResult = runCommandCapture('bunx', args);
		if (lastResult.stdout) console.log(lastResult.stdout);
		if (lastResult.stderr) console.error(lastResult.stderr);

		if (lastResult.success) {
			console.log(`${colors.green}Recovery succeeded after ${attempt} prune(s)${colors.reset}`);
			return lastResult;
		}

		const combined = stripAnsi(lastResult.stdout + '\n' + lastResult.stderr);
		const stillQuota = /DeploymentQuotaReached/.test(combined);
		if (!stillQuota) {
			// Different error — stop looping, let caller report the real failure.
			console.error(
				`${colors.red}Retry failed with non-quota error; aborting recovery.${colors.reset}`
			);
			return lastResult;
		}
		console.log(
			`${colors.yellow}  Retry still hit quota (likely race with concurrent build). Pruning again...${colors.reset}`
		);
	}

	console.error(
		`${colors.red}Prune fallback exhausted ${MAX_RECOVERY_ATTEMPTS} attempts without success.${colors.reset}`
	);
	return lastResult;
}

/**
 * Set up preview environment: SITE_URL, validate env vars, seed admin
 */
export async function setupPreviewEnv(
	deployment: ConvexDeployment,
	platform: PlatformContext
): Promise<void> {
	console.log('');
	console.log('=== Preview Environment Debug ===');
	console.log(`  Platform: ${platform.platform}`);
	console.log(`  Environment: ${platform.environment}`);
	console.log(`  Deploy URL: ${platform.deployUrl ?? '(not set)'}`);
	console.log(`  Git ref: ${platform.gitRef ?? '(not set)'}`);
	console.log(`  Site URL: ${platform.siteUrl ?? '(not set)'}`);
	console.log(`  Detected deployment: ${deployment.name ?? '(not detected)'}`);
	console.log('=================================');
	console.log('');

	if (!deployment.name) {
		console.error(
			`${colors.red}Error: Could not detect Convex deployment name from deploy output. Cannot set SITE_URL.${colors.reset}`
		);
		process.exit(1);
	}

	if (!platform.siteUrl) {
		console.error(
			`${colors.red}Error: Site URL is not available. Cannot set SITE_URL for preview.${colors.reset}`
		);
		process.exit(1);
	}

	const previewSiteUrl = platform.siteUrl;

	console.log(`Setting SITE_URL for preview: ${previewSiteUrl}`);
	console.log(`  Using --deployment-name ${deployment.name}`);

	// Set SITE_URL with retries
	const setResult = await runCommandWithRetry(
		'bunx',
		['convex', 'env', 'set', '--deployment-name', deployment.name, 'SITE_URL', previewSiteUrl],
		{ maxRetries: 5, delayMs: 5000, description: 'convex env set SITE_URL' }
	);

	if (!setResult.success) {
		console.error(
			`${colors.red}Failed to set SITE_URL for preview after all retries${colors.reset}`
		);
		console.error(`  stdout: ${setResult.stdout}`);
		console.error(`  stderr: ${setResult.stderr}`);
		process.exit(1);
	}

	console.log(`${colors.green}SITE_URL set successfully${colors.reset}`);

	// Verify SITE_URL
	console.log('Verifying SITE_URL was set correctly...');
	const listResult = runCommandCapture('bunx', [
		'convex',
		'env',
		'list',
		'--deployment-name',
		deployment.name
	]);

	if (listResult.success) {
		const siteUrlMatch = listResult.stdout.match(/^SITE_URL=(.+)$/m);
		if (siteUrlMatch) {
			const actualSiteUrl = siteUrlMatch[1];
			if (actualSiteUrl === previewSiteUrl) {
				console.log(`${colors.green}SITE_URL verified: ${actualSiteUrl}${colors.reset}`);
			} else {
				console.error(
					`${colors.red}SITE_URL mismatch! Expected: ${previewSiteUrl}, Got: ${actualSiteUrl}${colors.reset}`
				);
				process.exit(1);
			}
		} else {
			console.warn(
				`${colors.yellow}Warning: Could not find SITE_URL in env list output${colors.reset}`
			);
			console.log(`  Output: ${listResult.stdout}`);
		}
	} else {
		console.warn(
			`${colors.yellow}Warning: Could not verify SITE_URL (env list failed)${colors.reset}`
		);
		console.log(`  stderr: ${listResult.stderr}`);
	}

	// Validate preview env vars
	validateConvexEnv(platform, deployment);

	// Seed preview admin (optional)
	const previewAdminPassword = process.env.PREVIEW_ADMIN_PASSWORD;
	if (previewAdminPassword) {
		console.log('');
		console.log('Seeding preview admin user...');

		const setPwResult = await runCommandWithRetry(
			'bunx',
			[
				'convex',
				'env',
				'set',
				'--deployment-name',
				deployment.name,
				'PREVIEW_ADMIN_PASSWORD',
				previewAdminPassword
			],
			{ maxRetries: 3, delayMs: 3000, description: 'convex env set PREVIEW_ADMIN_PASSWORD' }
		);

		if (!setPwResult.success) {
			console.warn(
				`${colors.yellow}Warning: Failed to set PREVIEW_ADMIN_PASSWORD, skipping admin seed${colors.reset}`
			);
		} else {
			const seedResult = runCommandCapture('bunx', [
				'convex',
				'run',
				'--deployment-name',
				deployment.name,
				'previewDev:ensurePreviewAdmin'
			]);

			if (seedResult.success) {
				console.log(`${colors.green}=== Preview Admin Seeded ===${colors.reset}`);
				console.log(`  Email:    admin@preview.dev`);
				console.log(`  Password: (set via PREVIEW_ADMIN_PASSWORD)`);
				console.log(`${colors.green}============================${colors.reset}`);
				if (seedResult.stdout) console.log(`  Result: ${seedResult.stdout}`);
			} else {
				console.warn(
					`${colors.yellow}Warning: Preview admin seeding failed (non-blocking)${colors.reset}`
				);
				if (seedResult.stdout) console.log(`  stdout: ${seedResult.stdout}`);
				if (seedResult.stderr) console.log(`  stderr: ${seedResult.stderr}`);
			}
		}
	} else {
		console.log(
			`${colors.yellow}PREVIEW_ADMIN_PASSWORD not set, skipping preview admin seed${colors.reset}`
		);
	}
}

/**
 * Write E2E config for preview deployments
 */
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

	if (!fs.existsSync(configDir)) {
		fs.mkdirSync(configDir, { recursive: true });
	}

	fs.writeFileSync(configPath, JSON.stringify(e2eConfig, null, 2));
	console.log(`${colors.green}E2E config written to ${configPath}${colors.reset}`);
}

/**
 * Compute build environment and build SvelteKit
 */
export function computeBuildEnv(
	platform: PlatformContext,
	deployment: ConvexDeployment
): Record<string, string | undefined> {
	const buildEnv: Record<string, string | undefined> = { ...process.env };
	delete buildEnv.__VARLOCK_ENV;

	// Use actual deployment URL from convex deploy output (most reliable)
	// Falls back to parsing CONVEX_DEPLOY_KEY if output parsing failed
	let deploymentUrlSlug = deployment.urlSlug;

	if (!deploymentUrlSlug) {
		const convexDeployKey = process.env.CONVEX_DEPLOY_KEY;
		if (convexDeployKey) {
			const parts = convexDeployKey.split('|');
			if (parts.length >= 2) {
				const keyParts = parts[0].split(':');
				const name = keyParts[keyParts.length - 1];
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

	// For preview deployments, set SITE_URL for SvelteKit build
	if (platform.isPreview && platform.siteUrl) {
		buildEnv.SITE_URL = platform.siteUrl;
		console.log(`SITE_URL (for SvelteKit build): ${buildEnv.SITE_URL}`);
	}

	return buildEnv;
}

/**
 * Build SvelteKit with computed environment
 */
export function buildSvelteKit(buildEnv: Record<string, string | undefined>): void {
	console.log('Building SvelteKit...');
	if (!runCommand('bun', ['run', 'build'], buildEnv)) {
		console.error(`${colors.red}SvelteKit build failed${colors.reset}`);
		process.exit(1);
	}
}
