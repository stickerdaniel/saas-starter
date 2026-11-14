import * as path from 'node:path';
import { BaseSequencer, type TestSpecification } from 'vitest/node';
import { toolingTestSettings } from './vitest-settings.ts';

/**
 * Root-relative paths of the slowest tooling suites, 18 to 38 s of test time each on a hosted
 * runner, slowest first: every `scripts/static-checks*.test.ts` file plus the named suites of
 * similar length.
 */
export const HEAVY_TOOLING_SUITES = [
	'eslint/config-coverage.test.ts',
	'scripts/static-checks.format-scope.test.ts',
	'scripts/static-checks.format-paths.test.ts',
	'scripts/static-checks.format-project.test.ts',
	'scripts/static-checks.compat-contract.test.ts',
	'scripts/static-checks.knip.test.ts',
	'scripts/static-checks.compat.test.ts',
	'scripts/static-checks.knip-cli.test.ts',
	'scripts/static-checks.format.test.ts',
	'scripts/static-checks.processes.test.ts',
	'scripts/static-checks.knip-types.test.ts',
	'scripts/template-setup.integration.test.ts',
	'scripts/playwright-selection.test.ts',
	'scripts/third-party-licenses/kit-build.test.ts',
	'scripts/static-checks.test.ts'
];

const heavyPositions = new Map(HEAVY_TOOLING_SUITES.map((file, position) => [file, position]));

/**
 * The 0-based shard of the heavy suite at `position` when the list is dealt in snake order:
 * positions 0..n-1 go to shards 1..n, the next n back to shards n..1, and so on, so the
 * slowest suite of one round shares its shard with the fastest of the next.
 */
function snakeShard(position: number, count: number): number {
	const offset = position % count;
	return Math.floor(position / count) % 2 === 0 ? offset : count - 1 - offset;
}

/**
 * Shards like `BaseSequencer`, except that the heavy tooling suites are dealt over the shards
 * in snake order of `HEAVY_TOOLING_SUITES`. The SHA-1 path placement of `BaseSequencer` put
 * two or three heavy suites into one tooling shard, which then set the time of the whole
 * check. Every other file keeps the shard `BaseSequencer` gives it within its own project.
 */
export class HeavySuiteSequencer extends BaseSequencer {
	override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
		const { root, shard } = this.ctx.config;
		if (!shard) throw new Error('Vitest calls shard() only with --shard');
		const isTooling = (spec: TestSpecification) => spec.project.name === toolingTestSettings.name;
		const heavyPosition = (spec: TestSpecification) =>
			heavyPositions.get(path.relative(root, spec.moduleId).replaceAll('\\', '/'));

		const tooling = files.filter(isTooling);
		const others = await super.shard(files.filter((spec) => !isTooling(spec)));
		const light = (await super.shard(tooling)).filter((spec) => heavyPosition(spec) === undefined);
		const heavy = tooling.filter((spec) => {
			const position = heavyPosition(spec);
			return position !== undefined && snakeShard(position, shard.count) === shard.index - 1;
		});
		return [...others, ...light, ...heavy];
	}
}
