#!/usr/bin/env bun
/**
 * Build-time validation: Ensures all required Convex environment variables are set.
 * Called by vercel-deploy.ts before deploying.
 *
 * Usage:
 *   bun scripts/validate-convex-env.ts                              # development deployment
 *   bun scripts/validate-convex-env.ts --prod                       # production deployment
 *   bun scripts/validate-convex-env.ts --deployment-name <name>     # specific deployment by name
 *   bun scripts/validate-convex-env.ts --preview-name <branch>      # preview deployment (legacy)
 *
 * For preview deployments, prefer --deployment-name with the actual deployment name
 * instead of --preview-name, as --preview-name uses a separate namespace.
 */

import { execSync } from 'child_process';
import { REQUIRED_VAR_NAMES } from '../src/lib/convex/env';

// Single source of truth is defined in src/lib/convex/env.ts

const isProd = process.argv.includes('--prod');
const deploymentNameIndex = process.argv.indexOf('--deployment-name');
const deploymentName = deploymentNameIndex !== -1 ? process.argv[deploymentNameIndex + 1] : null;
const previewNameIndex = process.argv.indexOf('--preview-name');
const previewName = previewNameIndex !== -1 ? process.argv[previewNameIndex + 1] : null;

// Priority: --deployment-name > --prod > --preview-name > default (local dev)
const deploymentFlag = deploymentName
	? ` --deployment-name ${deploymentName}`
	: isProd
		? ' --prod'
		: previewName
			? ` --preview-name ${previewName}`
			: '';
const cmd = `bunx convex env list${deploymentFlag}`;

if (deploymentName) {
	console.log(`Using --deployment-name ${deploymentName}`);
}

let output: string;
try {
	output = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
} catch (error) {
	console.error('Failed to list Convex env vars:', (error as Error).message);
	process.exit(1);
}

// Parse "NAME=value" lines
const existingVars = new Set(
	output
		.split('\n')
		.map((line) => line.match(/^(\w+)=/)?.[1])
		.filter(Boolean)
);

const missingVars = REQUIRED_VAR_NAMES.filter((name) => !existingVars.has(name));

if (missingVars.length > 0) {
	console.error('');
	console.error('============================================================');
	console.error('❌ MISSING REQUIRED CONVEX ENVIRONMENT VARIABLES');
	console.error('============================================================');
	console.error('');
	console.error('The following variables are not set in your Convex environment:');
	for (const name of missingVars) {
		console.error(`  - ${name}`);
	}
	console.error('');
	console.error('Set them via CLI:');
	console.error(`  bunx convex env set VARIABLE_NAME value${deploymentFlag}`);
	console.error('');
	console.error('Or set in Convex Dashboard:');
	console.error('  https://dashboard.convex.dev → Your Project → Settings → Environment Variables');
	console.error('');
	console.error('============================================================');
	process.exit(1);
}

console.log('✅ All required Convex environment variables are set');
