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

import * as fs from 'node:fs';
import * as path from 'node:path';
import { validateCapabilityEnvironment, type CapabilityProfile } from '../src/lib/dev/features';
import type { CommandResult } from './process/command-runner';
import { reportCliFailure, withCliSignals } from './deploy/cli';
import { stripAnsi } from './deploy/utils';
import {
	createDeploymentExecution,
	DeploymentError,
	requireCommand,
	throwIfStopped
} from './deploy/execution';

export function getRequiredVarNames(
	content = fs.readFileSync(path.resolve('.env-convex.schema'), 'utf-8')
): string[] {
	const lines = content.split('\n');
	const headerEnd = lines.findIndex((line) => line.trim() === '# ---');
	if (headerEnd === -1)
		throw new DeploymentError('configuration', '.env-convex.schema: missing header separator.');
	const required: string[] = [];
	let currentBlockIsOptional = false;
	for (const raw of lines.slice(headerEnd + 1)) {
		const line = raw.trim();
		if (!line) {
			currentBlockIsOptional = false;
			continue;
		}
		if (line.startsWith('#')) {
			if (line.includes('@optional')) currentBlockIsOptional = true;
			continue;
		}
		const name = line.match(/^([A-Z_][A-Z0-9_]*)=/)?.[1];
		if (name && !currentBlockIsOptional) required.push(name);
	}
	return required;
}

/** Convex CLI 1.42.x permission markers for `convex env list`. */
export function isConvex142EnvListPermissionDenied(result: CommandResult): boolean {
	if (result.ok || result.kind !== 'non_zero_exit') return false;
	const output = stripAnsi(`${result.stdout}\n${result.stderr}`);
	return /\b(ViewEnvironmentVariables|deployment:env:view)\b/i.test(output);
}

export async function validateRequiredConvexEnv(
	deploymentArgs: string[],
	execution = createDeploymentExecution()
): Promise<Record<string, string> | null> {
	const required = getRequiredVarNames();
	const result = await execution.run({
		command: 'bunx',
		args: ['convex', 'env', 'list', ...deploymentArgs],
		output: 'capture'
	});
	throwIfStopped(result);
	if (isConvex142EnvListPermissionDenied(result)) {
		console.warn(
			'Skipping Convex env validation: the deploy key cannot list env vars. ' +
				`Ensure these are set on the deployment: ${required.join(', ')}. ` +
				'A missing required var still fails the deploy via backend env validation.'
		);
		return null;
	}
	requireCommand(result, 'Failed to list Convex environment variables.');
	const environment: Record<string, string> = {};
	for (const line of result.stdout.split('\n')) {
		const separator = line.indexOf('=');
		if (separator <= 0) continue;
		const name = line.slice(0, separator);
		if (!/^\w+$/.test(name)) continue;
		environment[name] = line.slice(separator + 1);
	}
	const missing = required.filter((name) => !(name in environment));
	if (missing.length) {
		throw new DeploymentError(
			'configuration',
			'Missing required Convex environment variables: ' +
				missing.join(', ') +
				`\nSet them via: bunx convex env set VARIABLE_NAME value ${deploymentArgs.join(' ')}`
		);
	}
	console.log('All required Convex environment variables are set.');
	return environment;
}

export async function validateConvexEnvironment(
	deploymentArgs: string[],
	expectedProfile: CapabilityProfile | undefined,
	execution = createDeploymentExecution()
): Promise<void> {
	const environment = await validateRequiredConvexEnv(deploymentArgs, execution);
	if (!environment) return;
	if (expectedProfile && environment.CAPABILITY_PROFILE !== expectedProfile) {
		throw new DeploymentError(
			'configuration',
			`Convex capability profile does not match the intended ${expectedProfile} profile.`
		);
	}
	try {
		validateCapabilityEnvironment(environment);
	} catch {
		throw new DeploymentError(
			'configuration',
			'Convex provider configuration is incomplete or invalid for its capability profile.'
		);
	}
}

export async function main(
	args = process.argv.slice(2),
	execution = createDeploymentExecution()
): Promise<void> {
	const valueAfter = (flag: string) => {
		const index = args.indexOf(flag);
		return index === -1 ? undefined : args[index + 1];
	};
	const deploymentName = valueAfter('--deployment-name');
	const previewName = valueAfter('--preview-name');
	const expectedProfile = valueAfter('--expected-profile') as CapabilityProfile | undefined;
	if (
		args.includes('--expected-profile') &&
		(!expectedProfile || !['local', 'test', 'preview', 'production'].includes(expectedProfile))
	) {
		throw new DeploymentError(
			'configuration',
			'--expected-profile requires local, test, preview, or production'
		);
	}
	const deploymentArgs = deploymentName
		? ['--deployment-name', deploymentName]
		: args.includes('--prod')
			? ['--prod']
			: previewName
				? ['--preview-name', previewName]
				: [];
	await validateConvexEnvironment(deploymentArgs, expectedProfile, execution);
}

if (import.meta.main) {
	await withCliSignals((signal) => main(undefined, createDeploymentExecution({ signal }))).catch(
		(error) => {
			reportCliFailure(error);
			process.exitCode = 1;
		}
	);
}
