import * as path from 'node:path';
import { BaseSequencer, type TestSpecification } from 'vitest/node';
import { toolingTestSettings } from './vitest-settings.ts';

/**
 * Root-relative paths of the slowest tooling suites, 14 to 38 s of test time each on a hosted
 * runner, slowest first, so that a round-robin over this order puts the slowest suites into
 * different shards.
 */
export const HEAVY_TOOLING_SUITES = [
	'scripts/static-checks.knip.test.ts',
	'scripts/static-checks.processes.test.ts',
	'scripts/static-checks.format-paths.test.ts',
	'scripts/static-checks.compat-contract.test.ts',
	'eslint/config-coverage.test.ts',
	'scripts/static-checks.knip-types.test.ts',
	'scripts/static-checks.knip-cli.test.ts',
	'scripts/static-checks.format.test.ts',
	'scripts/static-checks.compat.test.ts',
	'scripts/static-checks.format-scope.test.ts',
	'scripts/static-checks.format-project.test.ts',
	'scripts/static-checks.test.ts'
];

const heavyPositions = new Map(HEAVY_TOOLING_SUITES.map((file, position) => [file, position]));

/**
 * Shards like `BaseSequencer`, except that shard k of n also receives the heavy tooling suites
 * at positions p with p % n === k - 1 in `HEAVY_TOOLING_SUITES`. The SHA-1 path placement of
 * `BaseSequencer` put two or three heavy suites into one tooling shard, which then set the
 * time of the whole check. Every other file keeps the shard `BaseSequencer` gives it within
 * its own project.
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
			return position !== undefined && position % shard.count === shard.index - 1;
		});
		return [...others, ...light, ...heavy];
	}
}
