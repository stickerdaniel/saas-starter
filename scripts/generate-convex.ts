#!/usr/bin/env bun
/**
 * Smart Convex codegen wrapper that auto-detects the environment.
 *
 * Resolves #312: plain `convex codegen` fails with a misleading error when
 * no cloud deployment is configured. This script detects the active backend
 * (self-hosted, cloud, local embedded, or none) and runs the appropriate
 * codegen strategy with clear, template-specific error messages.
 *
 * Priority order:
 *   1. Self-hosted (CONVEX_SELF_HOSTED_URL + CONVEX_SELF_HOSTED_ADMIN_KEY)
 *   2. Cloud (CONVEX_DEPLOYMENT not starting with "local:")
 *   3. Local embedded backend (running dev server detected via .convex/.backend-url)
 *   4. Offline fallback (validate existing generated types, or bootstrap on fresh clone)
 */

import { spawnSync } from 'child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PROJECT_DIR = path.resolve(import.meta.dirname, '..');
const CONVEX_STATE_DIR = path.join(PROJECT_DIR, '.convex');
const BACKEND_URL_FILE = path.join(CONVEX_STATE_DIR, '.backend-url');
const GENERATED_API = path.join(PROJECT_DIR, 'src/lib/convex/_generated/api.d.ts');
const PROBE_TIMEOUT_MS = 2000;

// ---------------------------------------------------------------------------
// Helpers (copied from vite.config.ts to avoid importing Vite internals)
// ---------------------------------------------------------------------------

/** Parse a dotenv-style file into a Record<string, string>. */
function parseEnvFile(filePath: string): Record<string, string> {
	if (!fs.existsSync(filePath)) return {};
	const vars: Record<string, string> = {};
	for (const line of fs.readFileSync(filePath, 'utf-8').split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const effective = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
		const eqIndex = effective.indexOf('=');
		if (eqIndex === -1) continue;
		const key = effective.slice(0, eqIndex).trim();
		let value = effective.slice(eqIndex + 1).trim();
		if (!value.startsWith('"') && !value.startsWith("'")) {
			const hashIndex = value.indexOf(' #');
			if (hashIndex !== -1) value = value.slice(0, hashIndex).trim();
		}
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		if (key && value) {
			vars[key] = value;
		}
	}
	return vars;
}

/** Compute the local Convex state directory ID (matches convex-vite-plugin). */
function computeLocalConvexStateId(projectDir: string): string {
	let gitBranch = 'unknown';
	try {
		const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
			cwd: projectDir,
			encoding: 'utf-8',
			stdio: ['ignore', 'pipe', 'pipe']
		});
		if (result.status === 0 && result.stdout) {
			gitBranch = result.stdout.trim();
		}
	} catch {
		// Fall back to "unknown" branch marker.
	}

	const input = `${gitBranch}:${projectDir}`;
	const hash = crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
	const sanitizedBranch = gitBranch.replace(/[^a-zA-Z0-9-]/g, '-');
	return `${sanitizedBranch}-${hash}`;
}

/** Probe a URL with a short timeout. Returns true if the server responds. */
async function probeBackend(url: string): Promise<boolean> {
	try {
		const response = await fetch(`${url}/version`, {
			signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
		});
		return response.ok;
	} catch {
		return false;
	}
}

/** Run a command and return its exit code + combined output. */
function runCommand(command: string, args: string[]): { code: number; output: string } {
	const result = spawnSync(command, args, {
		cwd: PROJECT_DIR,
		encoding: 'utf-8',
		stdio: ['inherit', 'pipe', 'pipe']
	});
	const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
	return { code: result.status ?? 1, output };
}

function printError(title: string, details: string[]): void {
	console.error('');
	console.error('============================================================');
	console.error(title.toUpperCase());
	console.error('============================================================');
	console.error('');
	for (const line of details) {
		console.error(line);
	}
	console.error('');
	console.error('============================================================');
}

/** Resolve a var from .env.local and process.env (process.env takes precedence). */
function resolveVar(envFile: Record<string, string>, name: string): string | undefined {
	return process.env[name] || envFile[name] || undefined;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	const envFile = parseEnvFile(path.join(PROJECT_DIR, '.env.local'));

	const convexDeployment = resolveVar(envFile, 'CONVEX_DEPLOYMENT');
	const selfHostedUrl = resolveVar(envFile, 'CONVEX_SELF_HOSTED_URL');
	const selfHostedKey = resolveVar(envFile, 'CONVEX_SELF_HOSTED_ADMIN_KEY');

	const hasSelfHosted = Boolean(selfHostedUrl || selfHostedKey);
	const hasCloud = Boolean(convexDeployment && !convexDeployment.startsWith('local:'));

	// --- Pre-check: conflicting env vars ---

	if (hasSelfHosted && hasCloud) {
		printError('Conflicting Convex configuration', [
			'Both CONVEX_DEPLOYMENT and self-hosted vars are set.',
			`  CONVEX_DEPLOYMENT:             ${convexDeployment ? 'set' : 'not set'}`,
			`  CONVEX_SELF_HOSTED_URL:        ${selfHostedUrl ? 'set' : 'not set'}`,
			`  CONVEX_SELF_HOSTED_ADMIN_KEY:  ${selfHostedKey ? 'set' : 'not set'}`,
			'',
			'The Convex CLI treats these as mutually exclusive.',
			'Remove one group from .env.local to resolve the conflict.'
		]);
		process.exit(1);
	}

	if (hasSelfHosted && !(selfHostedUrl && selfHostedKey)) {
		printError('Incomplete self-hosted configuration', [
			'Both CONVEX_SELF_HOSTED_URL and CONVEX_SELF_HOSTED_ADMIN_KEY must be set.',
			'',
			`  CONVEX_SELF_HOSTED_URL:       ${selfHostedUrl ? 'set' : 'MISSING'}`,
			`  CONVEX_SELF_HOSTED_ADMIN_KEY:  ${selfHostedKey ? 'set' : 'MISSING'}`,
			'',
			'Set the missing variable in .env.local.'
		]);
		process.exit(1);
	}

	// --- Path 1: Self-hosted deployment ---

	if (selfHostedUrl && selfHostedKey) {
		console.log('Using self-hosted deployment for codegen...');
		const { code, output } = runCommand('bunx', ['convex', 'codegen']);
		if (code !== 0) {
			printError('Self-hosted codegen failed', [
				output,
				'Check your CONVEX_SELF_HOSTED_URL and CONVEX_SELF_HOSTED_ADMIN_KEY in .env.local.'
			]);
			process.exit(1);
		}
		console.log('Codegen complete (self-hosted).');
		return;
	}

	// --- Path 2: Cloud deployment ---

	if (hasCloud) {
		console.log(`Using cloud deployment for codegen (${convexDeployment})...`);
		const { code, output } = runCommand('bunx', ['convex', 'codegen']);
		if (code !== 0) {
			printError('Cloud codegen failed', [
				output,
				'Make sure you are logged in: bunx convex login',
				'Or unset CONVEX_DEPLOYMENT in .env.local and use `bun run dev` for local codegen.'
			]);
			process.exit(1);
		}
		console.log('Codegen complete (cloud).');
		return;
	}

	// --- Path 3: Local backend running ---

	if (fs.existsSync(BACKEND_URL_FILE)) {
		const backendUrl = fs.readFileSync(BACKEND_URL_FILE, 'utf-8').trim();
		if (backendUrl && (await probeBackend(backendUrl))) {
			console.log(`Local backend detected at ${backendUrl}.`);

			const stateId = computeLocalConvexStateId(PROJECT_DIR);
			const keysPath = path.join(CONVEX_STATE_DIR, stateId, 'keys.json');

			if (!fs.existsSync(keysPath)) {
				console.warn(
					`Warning: Local backend is running but no keys found at .convex/${stateId}/keys.json.`
				);
				console.warn(
					'This can happen after switching branches. Falling back to offline validation.'
				);
			} else {
				const keys = JSON.parse(fs.readFileSync(keysPath, 'utf-8'));
				const { code, output } = runCommand('bunx', [
					'convex',
					'codegen',
					'--url',
					backendUrl,
					'--admin-key',
					keys.adminKey
				]);

				if (code === 0) {
					console.log('Codegen complete (local backend).');
					return;
				}

				console.warn('Warning: Local codegen failed, falling back to offline validation.');
				console.warn(output);
			}
		}
	}

	// --- Path 4: Offline fallback ---

	let offlineFailed = false;

	if (fs.existsSync(GENERATED_API)) {
		console.log('No Convex backend available. Validating existing generated types...');
		const { code, output } = runCommand('bun', ['run', 'check:convex']);
		if (code !== 0) {
			console.warn('Type check produced errors against existing generated types:');
			console.warn(output);
			offlineFailed = true;
		} else {
			console.log('Existing generated types are valid.');
		}
	} else {
		console.log('No Convex backend available and no generated types found (fresh clone).');
		console.log('Bootstrapping minimal type stubs with --system-udfs...');
		const { code, output } = runCommand('bunx', ['convex', 'codegen', '--system-udfs']);
		if (code !== 0) {
			console.warn('Bootstrap codegen failed:');
			console.warn(output);
			offlineFailed = true;
		} else {
			console.log(
				'Bootstrap complete. Note: component types are missing until you run `bun run dev`.'
			);
		}
	}

	console.log('');
	console.log('Start the dev server with `bun run dev` to generate up-to-date types.');

	if (offlineFailed) {
		process.exit(1);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
