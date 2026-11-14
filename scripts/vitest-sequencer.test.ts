import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	BaseSequencer,
	createVitest,
	type TestSequencerConstructor,
	type TestSpecification,
	type Vitest
} from 'vitest/node';
import { parse as parseYaml } from 'yaml';
import { HEAVY_TOOLING_SUITES } from './vitest-sequencer';
import { toolingTestSettings } from './vitest-settings';

const ROOT = path.resolve(import.meta.dirname, '..');

const relative = (spec: TestSpecification) =>
	path.relative(ROOT, spec.moduleId).replaceAll('\\', '/');
const key = (spec: TestSpecification) => `${spec.project.name} ${relative(spec)} ${spec.pool}`;
const isHeavy = (spec: TestSpecification) => HEAVY_TOOLING_SUITES.includes(relative(spec));
const isTooling = (spec: TestSpecification) => spec.project.name === toolingTestSettings.name;

const matrix = (
	parseYaml(fs.readFileSync(path.join(ROOT, '.github/workflows/static-checks.yml'), 'utf-8')) as {
		jobs: Record<string, { strategy?: { matrix?: { include?: Array<{ count: number }> } } }>;
	}
).jobs['unit-test-shards']?.strategy?.matrix?.include;
if (!matrix?.length) throw new TypeError('the unit-test-shards job carried no matrix rows');
const COUNTS = [...new Set([5, 6, ...matrix.map((row) => row.count)])];

// One Vitest instance resolves the root config and discovers the specs of every project.
let vitest: Vitest;
let specs: TestSpecification[];
let Sequencer: TestSequencerConstructor;

beforeAll(async () => {
	vitest = await createVitest(
		{ root: ROOT, config: 'vite.config.ts', watch: false, run: true },
		{ logLevel: 'silent' }
	);
	specs = await vitest.globTestSpecifications();
	Sequencer = vitest.config.sequence.sequencer;
}, 60_000);

afterAll(() => vitest?.close());

/** Runs `shard` for every index of `count`, the way one CI job per index would. */
async function partition(
	Constructor: TestSequencerConstructor,
	files: TestSpecification[],
	count: number
): Promise<TestSpecification[][]> {
	const sequencer = new Constructor(vitest);
	const shards: TestSpecification[][] = [];
	try {
		for (let index = 1; index <= count; index++) {
			vitest.config.shard = { index, count };
			shards.push(await sequencer.shard([...files]));
		}
	} finally {
		delete vitest.config.shard;
	}
	return shards;
}

const keys = (shards: TestSpecification[][], keep: (spec: TestSpecification) => boolean) =>
	shards.map((shard) => shard.filter(keep).map(key).sort());

describe('heavy suite sequencer', () => {
	it('is the sequencer the root config selects', () => {
		expect(Sequencer).not.toBe(BaseSequencer);
		expect(Sequencer.prototype).toBeInstanceOf(BaseSequencer);
	});

	it('lists every heavy tooling suite once and nothing else', () => {
		const discovered = specs
			.filter(isTooling)
			.map(relative)
			.filter(
				(file) =>
					/^scripts\/static-checks[^/]*\.test\.ts$/.test(file) ||
					file === 'eslint/config-coverage.test.ts'
			);
		expect(new Set(HEAVY_TOOLING_SUITES).size, 'duplicate entries').toBe(
			HEAVY_TOOLING_SUITES.length
		);
		expect([...HEAVY_TOOLING_SUITES].sort()).toEqual(discovered.sort());
	});

	describe.each(COUNTS)('with %i shards', (count) => {
		it('runs every tooling spec exactly once and spreads the heavy suites', async () => {
			const tooling = specs.filter(isTooling);
			const shards = await partition(Sequencer, tooling, count);
			const base = await partition(BaseSequencer, tooling, count);

			for (const [index, shard] of shards.entries()) {
				expect(shard.length, `shard ${index + 1} is empty`).toBeGreaterThan(0);
				expect(
					shard.filter(isHeavy).length,
					`heavy suites in shard ${index + 1}`
				).toBeLessThanOrEqual(Math.ceil(HEAVY_TOOLING_SUITES.length / count));
			}
			expect(shards.flat().every((spec) => tooling.includes(spec))).toBe(true);
			expect(shards.flat().map(key).sort()).toEqual(tooling.map(key).sort());
			const light = (spec: TestSpecification) => !isHeavy(spec);
			expect(keys(shards, light)).toEqual(keys(base, light));
		});

		it('places app specs as BaseSequencer does, alone or mixed with tooling', async () => {
			const app = specs.filter((spec) => !isTooling(spec));
			const base = keys(await partition(BaseSequencer, app, count), () => true);
			expect(keys(await partition(Sequencer, app, count), () => true)).toEqual(base);

			const mixed = await partition(Sequencer, specs, count);
			expect(mixed.flat().map(key).sort()).toEqual(specs.map(key).sort());
			expect(keys(mixed, (spec) => !isTooling(spec))).toEqual(base);
			expect(keys(mixed, isTooling)).toEqual(
				keys(await partition(Sequencer, specs.filter(isTooling), count), () => true)
			);
		});
	});
});
