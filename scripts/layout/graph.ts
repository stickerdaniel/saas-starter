import { spawnSync } from 'node:child_process';
import { StaleInput, type Run } from './run.ts';

export function checkGraph(run: Run): void {
	if (!run.inputs.repositoryChecks) return;
	const result = spawnSync(process.execPath, ['scripts/check-workspace-graph.ts'], {
		cwd: run.checkout,
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024
	});
	if (result.status !== 0) {
		throw new StaleInput(
			`The workspace graph check fails on the tree:\n${result.stderr.trimEnd()}`
		);
	}
}
