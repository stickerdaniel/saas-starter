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
import { reportCliFailure, withCliSignals } from './deploy/cli';
import {
	createDeploymentExecution,
	DeploymentError,
	requireCommand,
	throwIfStopped
} from './deploy/execution';

export function getRequiredVarNames(
	content = fs.readFileSync(new URL('../.env-convex.schema', import.meta.url), 'utf-8')
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

export async function validateRequiredConvexEnv(
	deploymentArgs: string[],
	execution = createDeploymentExecution()
): Promise<void> {
	const required = getRequiredVarNames();
	const result = await execution.run({
		command: 'bunx',
		args: ['convex', 'env', 'list', ...deploymentArgs],
		output: 'capture'
	});
	throwIfStopped(result);
	if (
		!result.ok &&
		/ViewEnvironmentVariables|do not have permission/i.test(result.stderr + '\n' + result.stdout)
	) {
		console.warn(
			'Skipping Convex env validation: the deploy key cannot list env vars. ' +
				`Ensure these are set on the deployment: ${required.join(', ')}. ` +
				'A missing required var still fails the deploy via backend env validation.'
		);
		return;
	}
	requireCommand(result, 'Failed to list Convex environment variables.');
	const existing = new Set(
		result.stdout
			.split('\n')
			.map((line) => line.match(/^(\w+)=/)?.[1])
			.filter(Boolean)
	);
	const missing = required.filter((name) => !existing.has(name));
	if (missing.length) {
		throw new DeploymentError(
			'configuration',
			'Missing required Convex environment variables: ' +
				missing.join(', ') +
				`\nSet them via: bunx convex env set VARIABLE_NAME value ${deploymentArgs.join(' ')}`
		);
	}
	console.log('All required Convex environment variables are set.');
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
	const deploymentArgs = deploymentName
		? ['--deployment-name', deploymentName]
		: args.includes('--prod')
			? ['--prod']
			: previewName
				? ['--preview-name', previewName]
				: [];
	await validateRequiredConvexEnv(deploymentArgs, execution);
}

if (import.meta.main) {
	await withCliSignals((signal) => main(undefined, createDeploymentExecution({ signal }))).catch(
		(error) => {
			reportCliFailure(error);
			process.exitCode = 1;
		}
	);
}
