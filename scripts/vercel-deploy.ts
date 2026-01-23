/**
 * Vercel deployment script (cross-platform TypeScript version)
 *
 * Handles:
 * - Tolgee translation tagging and pulling
 * - Convex environment variable validation (production and preview)
 * - Convex deployment
 * - E2E config file generation (preview only)
 * - SvelteKit build
 */

import { spawnSync } from 'child_process';
import fs from 'fs';

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

/**
 * Strip ANSI escape codes from string
 */
function stripAnsi(str: string): string {
	return str.replace(/\x1b\[[0-9;]*m/g, '');
}

// Main execution
async function main(): Promise<void> {
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
	// Pre-deploy: Validate required Convex environment variables (production only)
	// Preview validation happens AFTER convex deploy (the instance doesn't exist yet)
	// =============================================================================
	if (VERCEL_ENV === 'production') {
		console.log('Checking required Convex environment variables (production)...');
		if (!runCommand('bun', ['scripts/validate-convex-env.ts', '--prod'])) {
			console.error(`${colors.red}Environment variable validation failed${colors.reset}`);
			process.exit(1);
		}
	} else if (VERCEL_ENV !== 'preview') {
		console.log(
			`${colors.yellow}Unknown environment: ${VERCEL_ENV}, skipping env var check${colors.reset}`
		);
	}

	// Deploy Convex functions and capture output to get actual deployment URL
	console.log('Deploying Convex functions...');
	const convexDeployResult = runCommandCapture('bunx', ['convex', 'deploy']);

	// Print the output so it's visible in logs
	if (convexDeployResult.stdout) console.log(convexDeployResult.stdout);
	if (convexDeployResult.stderr) console.error(convexDeployResult.stderr);

	if (!convexDeployResult.success) {
		console.error(`${colors.red}Convex deployment failed${colors.reset}`);
		process.exit(1);
	}

	// Extract deployment URL from output (e.g., "Deployed Convex functions to https://xxx.convex.cloud")
	// Check both stdout and stderr, strip ANSI codes
	const combinedOutput = stripAnsi(convexDeployResult.stdout + '\n' + convexDeployResult.stderr);
	const deployUrlMatch = combinedOutput.match(/https:\/\/([a-z0-9-]+)\.convex\.cloud/);
	const actualDeploymentName = deployUrlMatch ? deployUrlMatch[1] : null;

	if (actualDeploymentName) {
		console.log(`Detected Convex deployment: ${actualDeploymentName}`);
	} else {
		console.warn(
			`${colors.yellow}Warning: Could not parse deployment URL from convex deploy output${colors.reset}`
		);
	}

	// =============================================================================
	// Post-deploy: Validate preview environment variables (now instance exists)
	// =============================================================================
	if (VERCEL_ENV === 'preview' && VERCEL_GIT_COMMIT_REF) {
		// Set SITE_URL now that the preview instance exists
		if (VERCEL_URL) {
			const previewSiteUrl = `https://${VERCEL_URL}`;
			console.log(`Setting SITE_URL for preview: ${previewSiteUrl}`);

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
				console.error(`${colors.red}Failed to set SITE_URL for preview${colors.reset}`);
				process.exit(1);
			}
		}

		// Validate preview environment variables
		console.log('Checking required Convex environment variables (preview)...');
		if (
			!runCommand('bun', [
				'scripts/validate-convex-env.ts',
				'--preview-name',
				VERCEL_GIT_COMMIT_REF
			])
		) {
			console.error(`${colors.red}Environment variable validation failed${colors.reset}`);
			process.exit(1);
		}
	}

	// Build environment for SvelteKit with correct Convex URLs
	const buildEnv: Record<string, string | undefined> = { ...process.env };

	// Use actual deployment URL from convex deploy output (most reliable)
	// Falls back to parsing CONVEX_DEPLOY_KEY if output parsing failed
	let deploymentName = actualDeploymentName;

	if (!deploymentName && CONVEX_DEPLOY_KEY) {
		// Fallback: parse from deploy key
		// Format: prod:name|token or preview:identifier:name|token
		const parts = CONVEX_DEPLOY_KEY.split('|');
		if (parts.length >= 2) {
			const keyParts = parts[0].split(':');
			deploymentName = keyParts[keyParts.length - 1];
		}
	}

	if (deploymentName) {
		buildEnv.PUBLIC_CONVEX_URL = `https://${deploymentName}.convex.cloud`;
		buildEnv.PUBLIC_CONVEX_SITE_URL = `https://${deploymentName}.convex.site`;

		console.log(`PUBLIC_CONVEX_URL: ${buildEnv.PUBLIC_CONVEX_URL}`);
		console.log(`PUBLIC_CONVEX_SITE_URL: ${buildEnv.PUBLIC_CONVEX_SITE_URL}`);
	} else {
		console.warn(
			`${colors.yellow}Warning: Could not determine Convex deployment URL${colors.reset}`
		);
	}

	// For preview deployments, derive SITE_URL from VERCEL_URL for SvelteKit build
	// (Convex env var is set earlier in the validation step)
	if (VERCEL_ENV === 'preview' && VERCEL_URL) {
		buildEnv.SITE_URL = `https://${VERCEL_URL}`;
		console.log(`SITE_URL (for SvelteKit build): ${buildEnv.SITE_URL}`);
	}

	// =============================================================================
	// Write E2E config for preview deployments
	// This allows E2E tests to discover Convex URLs without webhooks or API calls
	// The config file is included in the deployment and fetched by the E2E workflow
	// =============================================================================
	if (VERCEL_ENV === 'preview' && deploymentName) {
		const e2eConfig = {
			convexUrl: buildEnv.PUBLIC_CONVEX_URL,
			convexSiteUrl: buildEnv.PUBLIC_CONVEX_SITE_URL,
			generatedAt: new Date().toISOString()
		};

		const configDir = 'static/.well-known';
		const configPath = `${configDir}/e2e-config.json`;

		// Ensure directory exists
		if (!fs.existsSync(configDir)) {
			fs.mkdirSync(configDir, { recursive: true });
		}

		fs.writeFileSync(configPath, JSON.stringify(e2eConfig, null, 2));
		console.log(`${colors.green}E2E config written to ${configPath}${colors.reset}`);
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
