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

import { detectPlatform } from './deploy/platform';
import {
	buildSvelteKit,
	computeBuildEnv,
	deployConvex,
	setupPreviewEnv,
	syncTranslations,
	validateConvexEnv,
	writeE2eConfig
} from './deploy/steps';
import { colors } from './deploy/utils';

async function main(): Promise<void> {
	const platform = detectPlatform();

	console.log(`Platform: ${platform.platform}`);
	console.log(`Environment: ${platform.environment}`);

	// 1. Sync translations
	syncTranslations(platform);

	// 2. Pre-deploy validation (production only; preview validated after deploy)
	if (!platform.isPreview) {
		validateConvexEnv(platform);
	}

	// 3. Deploy Convex functions
	const deployment = await deployConvex(platform);

	// 4. Preview: set SITE_URL, validate, seed admin
	if (platform.isPreview) {
		await setupPreviewEnv(deployment, platform);
	}

	// 5. Compute build env and write E2E config
	const buildEnv = computeBuildEnv(platform, deployment);
	writeE2eConfig(platform, buildEnv);

	// 6. Build SvelteKit
	buildSvelteKit(buildEnv);

	console.log(`${colors.green}Deployment complete!${colors.reset}`);
}

main();
