/**
 * Vercel deployment script (cross-platform TypeScript version)
 *
 * Handles:
 * - Tolgee translation tagging and pulling
 * - Convex environment variable validation (production and preview)
 * - Convex deployment
 * - SvelteKit build
 */

import { spawnSync } from 'child_process';

// Environment variables from Vercel
const VERCEL_ENV = process.env.VERCEL_ENV;
const VERCEL_URL = process.env.VERCEL_URL;
const VERCEL_GIT_COMMIT_REF = process.env.VERCEL_GIT_COMMIT_REF;
const CONVEX_DEPLOY_KEY = process.env.CONVEX_DEPLOY_KEY;

// ANSI colors for terminal output
const colors = {
	reset: '\x1b[0m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	red: '\x1b[31m'
};

/**
 * Run a command with inherited stdio
 */
function runCommand(
	command: string,
	args: string[],
	env?: Record<string, string | undefined>
): boolean {
	const result = spawnSync(command, args, {
		stdio: 'inherit',
		encoding: 'utf-8',
		env: env ?? process.env
	});
	return result.status === 0;
}

/**
 * Run a command and capture output
 */
function runCommandCapture(
	command: string,
	args: string[]
): { success: boolean; stdout: string; stderr: string } {
	const result = spawnSync(command, args, {
		encoding: 'utf-8'
	});
	return {
		success: result.status === 0,
		stdout: result.stdout?.trim() ?? '',
		stderr: result.stderr?.trim() ?? ''
	};
}

// Main execution
function main(): void {
	console.log(`Vercel Environment: ${VERCEL_ENV}`);

	// Tag translations based on environment
	if (VERCEL_ENV === 'production') {
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
	} else if (VERCEL_ENV === 'preview') {
		console.log('Tagging preview keys...');
		if (!runCommand('tolgee', ['tag', '--filter-extracted', '--tag', 'preview'])) {
			console.error(`${colors.red}Tolgee tagging failed${colors.reset}`);
			process.exit(1);
		}
	} else {
		console.log(`${colors.yellow}Unknown environment, skipping tagging${colors.reset}`);
	}

	// Pull latest translations
	console.log('Pulling latest translations...');
	if (!runCommand('tolgee', ['pull'])) {
		console.error(`${colors.red}Tolgee pull failed${colors.reset}`);
		process.exit(1);
	}

	// =============================================================================
	// Pre-deploy: Validate required Convex environment variables
	// =============================================================================
	if (VERCEL_ENV === 'production') {
		console.log('Checking required Convex environment variables (production)...');
		if (!runCommand('bun', ['scripts/validate-convex-env.ts', '--prod'])) {
			console.error(`${colors.red}Environment variable validation failed${colors.reset}`);
			process.exit(1);
		}
	} else if (VERCEL_ENV === 'preview') {
		// For preview deployments, set SITE_URL in Convex env before validation
		// (Required for auth module to load - derived from VERCEL_URL)
		if (VERCEL_URL && VERCEL_GIT_COMMIT_REF) {
			const previewSiteUrl = `https://${VERCEL_URL}`;
			console.log(`Setting SITE_URL for preview (${VERCEL_GIT_COMMIT_REF}): ${previewSiteUrl}`);

			// Use --preview-name to target the preview deployment by branch name
			const result = runCommandCapture('bunx', [
				'convex',
				'env',
				'set',
				'SITE_URL',
				previewSiteUrl,
				'--preview-name',
				VERCEL_GIT_COMMIT_REF
			]);

			if (!result.success) {
				console.error(`${colors.red}Failed to set SITE_URL for preview deployment${colors.reset}`);
				console.error(
					'Ensure preview deployment exists or set SITE_URL default in Convex Dashboard'
				);
				process.exit(1);
			}
		}

		// Validate preview environment variables
		console.log('Checking required Convex environment variables (preview)...');
		if (!runCommand('bun', ['scripts/validate-convex-env.ts'])) {
			console.error(`${colors.red}Environment variable validation failed${colors.reset}`);
			process.exit(1);
		}
	} else {
		console.log(
			`${colors.yellow}Unknown environment: ${VERCEL_ENV}, skipping env var check${colors.reset}`
		);
	}

	// Deploy Convex functions
	console.log('Deploying Convex functions...');
	if (!runCommand('bunx', ['convex', 'deploy'])) {
		console.error(`${colors.red}Convex deployment failed${colors.reset}`);
		process.exit(1);
	}

	// Extract deployment URL from CONVEX_DEPLOY_KEY and build environment for SvelteKit
	// Format: prod:name|token or preview:team:project:name|token
	// Production: prod:keen-labrador-829|... -> keen-labrador-829
	// Preview: preview:team:project:name|... -> name
	const buildEnv: Record<string, string | undefined> = { ...process.env };

	if (CONVEX_DEPLOY_KEY) {
		const keyPart = CONVEX_DEPLOY_KEY.split('|')[0];
		const parts = keyPart.split(':');
		const deploymentName = parts[parts.length - 1];

		buildEnv.PUBLIC_CONVEX_URL = `https://${deploymentName}.convex.cloud`;
		buildEnv.PUBLIC_CONVEX_SITE_URL = `https://${deploymentName}.convex.site`;

		console.log(`PUBLIC_CONVEX_URL: ${buildEnv.PUBLIC_CONVEX_URL}`);
		console.log(`PUBLIC_CONVEX_SITE_URL: ${buildEnv.PUBLIC_CONVEX_SITE_URL}`);
	}

	// For preview deployments, derive SITE_URL from VERCEL_URL for SvelteKit build
	// (Convex env var is set earlier in the validation step)
	if (VERCEL_ENV === 'preview' && VERCEL_URL) {
		buildEnv.SITE_URL = `https://${VERCEL_URL}`;
		console.log(`SITE_URL (for SvelteKit build): ${buildEnv.SITE_URL}`);
	}

	// Build SvelteKit with the computed environment variables
	console.log('Building SvelteKit...');
	if (!runCommand('bun', ['run', 'build'], buildEnv)) {
		console.error(`${colors.red}SvelteKit build failed${colors.reset}`);
		process.exit(1);
	}

	console.log(`${colors.green}Deployment complete!${colors.reset}`);
}

main();
