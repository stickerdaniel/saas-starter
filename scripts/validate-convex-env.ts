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
 *   bun scripts/validate-convex-env.ts --expected-profile preview   # require selected profile
 *
 * For preview deployments, prefer --deployment-name with the actual deployment name
 * instead of --preview-name, as --preview-name uses a separate namespace.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { validateCapabilityEnvironment, type CapabilityProfile } from '../src/lib/dev/features';
import { runCommandCapture } from './deploy/utils';

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
const expectedProfileIndex = process.argv.indexOf('--expected-profile');
const expectedProfile =
	expectedProfileIndex !== -1
		? (process.argv[expectedProfileIndex + 1] as CapabilityProfile | undefined)
		: undefined;
if (
	expectedProfileIndex !== -1 &&
	(!expectedProfile || !['local', 'test', 'preview', 'production'].includes(expectedProfile))
) {
	throw new Error('--expected-profile requires local, test, preview, or production');
}

// Priority: --deployment-name > --prod > --preview-name > default (local dev)
const deploymentArgs = deploymentName
	? ['--deployment-name', deploymentName]
	: isProd
		? ['--prod']
		: previewName
			? ['--preview-name', previewName]
			: [];

if (deploymentName) {
	console.log(`Using --deployment-name ${deploymentName}`);
}

const result = runCommandCapture('bunx', ['convex', 'env', 'list', ...deploymentArgs]);
if (!result.success) {
	const detail = `${result.stderr}\n${result.stdout}`;

	// Convex deploy keys can deploy but are denied ViewEnvironmentVariables, so
	// `convex env list` fails in CI when authenticated with a deploy key. Skip the
	// pre-flight check on a permission error instead of failing the build; the deploy
	// still runs and any genuinely missing required var is rejected by the Convex
	// backend at push time (convex.config.ts declares them, so `convex deploy` fails
	// with MissingEnvironmentVariables).
	if (/ViewEnvironmentVariables|do not have permission/i.test(detail)) {
		console.warn(
			'⚠️  Skipping Convex env validation: the deploy key cannot list env vars. ' +
				`Ensure these are set on the deployment: ${REQUIRED_VAR_NAMES.join(', ')}. ` +
				'A missing required var still fails the deploy via backend env validation.'
		);
		process.exit(0);
	}

	console.error('Failed to list Convex env vars:');
	if (result.stderr) console.error(result.stderr);
	if (result.stdout) console.error(result.stdout);
	process.exit(1);
}

// Parse "NAME=value" lines without logging values.
const environment: Record<string, string> = {};
for (const line of result.stdout.split('\n')) {
	const separator = line.indexOf('=');
	if (separator <= 0) continue;
	const name = line.slice(0, separator);
	if (!/^\w+$/.test(name)) continue;
	environment[name] = line.slice(separator + 1);
}

const missingVars = REQUIRED_VAR_NAMES.filter((name) => !(name in environment));

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
	const deploymentHint = deploymentArgs.length > 0 ? ` ${deploymentArgs.join(' ')}` : '';
	console.error('Set them via CLI:');
	console.error(`  bunx convex env set VARIABLE_NAME value${deploymentHint}`);
	console.error('');
	console.error('Or set in Convex Dashboard:');
	console.error('  https://dashboard.convex.dev → Your Project → Settings → Environment Variables');
	console.error('');
	console.error('============================================================');
	process.exit(1);
}

if (expectedProfile && environment.CAPABILITY_PROFILE !== expectedProfile) {
	console.error(
		`Convex capability profile does not match the intended ${expectedProfile} profile.`
	);
	process.exit(1);
}

try {
	validateCapabilityEnvironment(environment);
} catch {
	console.error(
		'Convex provider configuration is incomplete or invalid for its capability profile.'
	);
	process.exit(1);
}

console.log('✅ Convex environment and capability profile are valid');
