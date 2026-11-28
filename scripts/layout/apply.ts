#!/usr/bin/env bun
/**
 * apply.ts: turn this flat checkout into the workspace layout of version 3.
 *
 * It refuses a dirty checkout, records the source commit, applies the move table through the
 * mapper of the upstream-sync skill, and then runs its own steps in the fixed order of `STEPS`.
 * Each step names the input it reads; a step whose input is stale stops the run and names the
 * file. The result is a working tree, not a commit.
 *
 * Usage:
 *   bun scripts/layout/apply.ts
 */
import { spawnSync } from 'node:child_process';
import { INPUTS, STEPS, type Run } from './steps.ts';
import { prepareRun, StaleInput, type Inputs } from './run.ts';

function git(checkout: string, args: readonly string[]): string {
	const result = spawnSync('git', args, { cwd: checkout, encoding: 'utf8' });
	if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
	return result.stdout;
}

export async function apply(
	checkout: string,
	log: (line: string) => void,
	inputs: Inputs = INPUTS
): Promise<Run> {
	const dirty = git(checkout, ['status', '--porcelain', '--untracked-files=all']);
	if (dirty.trim()) {
		throw new StaleInput(`The checkout has uncommitted changes:\n${dirty.trimEnd()}`);
	}
	const run = await prepareRun(checkout, git(checkout, ['rev-parse', 'HEAD']).trim(), inputs);
	log(`Source commit: ${run.source}`);
	for (const step of STEPS) step.verify?.(run);
	for (const step of STEPS) {
		log(`${step.name}: ${step.input}`);
		step.run(run);
	}
	return run;
}

if (import.meta.main) {
	const checkout = git(process.cwd(), ['rev-parse', '--show-toplevel']).trim();
	try {
		await apply(checkout, console.log);
	} catch (error) {
		if (!(error instanceof StaleInput)) throw error;
		console.error(error.message);
		process.exit(1);
	}
}
