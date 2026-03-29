#!/usr/bin/env bun
/**
 * Build-time validation: Ensures all required Convex environment variables are set.
 * Called by deploy.ts before deploying.
 *
 * Required var names are derived from `.env-convex.schema` (varlock) - the single
 * source of truth. Any var whose preceding decorator block does NOT contain
 * `@optional` is considered required.
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
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Parse `.env-convex.schema` to extract required var names.
 * Scans past the `# ---` header separator, then collects var names whose
 * preceding decorator block does NOT contain `@optional`.
 */
function getRequiredVarNames(): string[] {
	const schemaPath = path.resolve(import.meta.dirname, '..', '.env-convex.schema');
	const content = fs.readFileSync(schemaPath, 'utf-8');
	const lines = content.split('\n');

	// Skip header (everything before `# ---`)
	const headerEnd = lines.findIndex((line) => line.trim() === '# ---');
	if (headerEnd === -1) {
		throw new Error('.env-convex.schema: missing `# ---` header separator');
	}

	const required: string[] = [];
	let currentBlockIsOptional = false;

	for (let i = headerEnd + 1; i < lines.length; i++) {
		const line = lines[i].trim();

		// Skip blank lines (reset decorator context)
		if (!line) {
			currentBlockIsOptional = false;
			continue;
		}

		// Comment/decorator line
		if (line.startsWith('#')) {
			if (line.includes('@optional')) {
				currentBlockIsOptional = true;
			}
			continue;
		}

		// Variable line: NAME= or NAME=value
		const match = line.match(/^([A-Z_][A-Z0-9_]*)=/);
		if (match && !currentBlockIsOptional) {
			required.push(match[1]);
		}
	}

	return required;
}

const REQUIRED_VAR_NAMES = getRequiredVarNames();

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
	console.error('MISSING REQUIRED CONVEX ENVIRONMENT VARIABLES');
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
