/**
 * Platform-aware deployment script
 *
 * Supports Vercel, Cloudflare Workers/Pages, and unknown platforms.
 * Platform is auto-detected from environment variables.
 *
 * Handles:
 * - Platform detection (Vercel, Cloudflare Workers/Pages, unknown)
 * - Tolgee translation tagging and pulling (optional, skipped without TOLGEE_API_KEY)
 * - Convex environment variable validation (production and preview)
 * - Convex deployment
 * - Preview environment setup (SITE_URL, admin seeding)
 * - E2E config file generation (preview only)
 * - SvelteKit build
 */

import { reportCliFailure, withCliSignals } from './deploy/cli';
import { checkAborted, createDeploymentExecution } from './deploy/execution';
import { detectPlatform } from './deploy/platform';
import {
	buildSvelteKit,
	computeBuildEnv,
	deployConvex,
	resolveDeploymentSiteOrigin,
	setProductionCapabilityProfile,
	setupPreviewEnv,
	syncTranslations,
	validateConvexEnv,
	writeE2eConfig,
	type PreviewRecovery
} from './deploy/steps';
import { colors } from './deploy/utils';

export async function main(
	execution = createDeploymentExecution(),
	options: { recovery?: PreviewRecovery; writeConfig?: typeof writeE2eConfig } = {}
): Promise<void> {
	checkAborted(execution.signal);
	const platform = detectPlatform(execution.env);
	console.log(`Platform: ${platform.platform}`);
	console.log(`Environment: ${platform.environment}`);
	const siteOrigin = resolveDeploymentSiteOrigin(platform, execution.env);
	await syncTranslations(platform, execution);
	if (!platform.isPreview) {
		await setProductionCapabilityProfile(platform, execution);
		await validateConvexEnv(platform, undefined, execution);
	}
	const deployment = await deployConvex(platform, execution, options.recovery);
	if (platform.isPreview) await setupPreviewEnv(deployment, platform, execution);
	checkAborted(execution.signal);
	const buildEnv = computeBuildEnv(platform, deployment, execution.env, siteOrigin);
	(options.writeConfig ?? writeE2eConfig)(platform, buildEnv);
	await buildSvelteKit(buildEnv, execution);
	checkAborted(execution.signal);
	console.log(`${colors.green}Deployment complete!${colors.reset}`);
}

/** This CLI boundary alone owns failure reporting and its process exit code. */
export async function runDeploymentCli(
	execution = createDeploymentExecution(),
	options: Parameters<typeof main>[1] = {}
): Promise<void> {
	try {
		await main(execution, options);
	} catch (error) {
		reportCliFailure(error);
		process.exitCode = 1;
	}
}

if (import.meta.main) {
	await withCliSignals((signal) => runDeploymentCli(createDeploymentExecution({ signal })));
}
