import { spawnSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { TestSpecification, Vitest } from 'vitest/node';
import { parse as parseYaml } from 'yaml';
import {
	assignShards,
	DURATIONS_FILE,
	DurationSequencer,
	type DurationManifest
} from './duration-sequencer.ts';
import { readBlobReport } from './update-test-durations.ts';

const ROOT = join(import.meta.dirname, '..');

describe('assignShards', () => {
	const durations = Object.fromEntries(
		Array.from({ length: 40 }, (_, i) => [`app:src/file-${i}.test.ts`, (i * 7) % 11])
	);
	const keys = [...Object.keys(durations), 'tooling:scripts/new.test.ts'];

	it.each([2, 3])('puts every key in exactly one of %i shards', (count) => {
		const shards = assignShards(keys, durations, count, 1);
		expect(shards).toHaveLength(count);
		for (const shard of shards) expect(shard.length).toBeGreaterThan(0);
		expect(shards.flat().sort()).toEqual([...keys].sort());
	});

	it('runs a file the manifest lacks on exactly one shard', () => {
		const keys = ['app:a.test.ts', 'app:b.test.ts', 'app:new.test.ts'];
		const shards = assignShards(keys, { 'app:a.test.ts': 4, 'app:b.test.ts': 2 }, 2, 1);
		expect(shards.filter((shard) => shard.includes('app:new.test.ts'))).toHaveLength(1);
		expect(shards.flat()).toHaveLength(3);
	});

	it('gives the same shards for keys discovered in any order', () => {
		const equal = Object.fromEntries(keys.map((key) => [key, 1]));
		const reversed = [...keys].reverse();
		expect(assignShards(reversed, equal, 2, 3)).toEqual(assignShards(keys, equal, 2, 3));
		expect(assignShards(reversed, durations, 3, 3)).toEqual(assignShards(keys, durations, 3, 3));
	});

	it('balances measured cost rather than file count', () => {
		const quick = Array.from({ length: 5 }, (_, i) => `app:quick-${i}.test.ts`);
		const skewed = { 'app:slow.test.ts': 100, ...Object.fromEntries(quick.map((key) => [key, 1])) };
		expect(assignShards(Object.keys(skewed), skewed, 2, 1)).toEqual([['app:slow.test.ts'], quick]);
	});

	it('fills the workers idle beside a long file before lengthening another shard', () => {
		// Projects run one after another over 3 workers. The pole holds its shard for 9 s, time
		// enough for every other tooling file, so the app files get the second shard.
		const tooling = Array.from({ length: 6 }, (_, i) => `tooling:quick-${i}.test.ts`);
		const app = Array.from({ length: 6 }, (_, i) => `app:view-${i}.test.ts`);
		const weights = {
			'tooling:pole.test.ts': 9,
			...Object.fromEntries(tooling.map((key) => [key, 1])),
			...Object.fromEntries(app.map((key) => [key, 2]))
		};
		expect(assignShards(Object.keys(weights), weights, 2, 3)).toEqual([
			['tooling:pole.test.ts', ...tooling],
			app
		]);
	});
});

describe('DurationSequencer', () => {
	const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'duration-sequencer-')));
	afterAll(() => rmSync(fixture, { recursive: true, force: true }));

	const files = ['one', 'two', 'three', 'four', 'fresh'];
	// FAIL_TEST names the one `<project>:<file>` whose assertion fails.
	for (const name of files) {
		writeFileSync(
			join(fixture, `${name}.test.ts`),
			`test('${name}', ({ task }) => expect([task.file.projectName, task.file.name].join(':')).not.toBe(process.env.FAIL_TEST));\n`
		);
	}
	writeFileSync(join(fixture, 'idle.test.ts'), `test.skip('idle', () => {});\n`);
	const keys = ['alpha', 'beta']
		.flatMap((project) => [...files, 'idle'].map((name) => `${project}:${name}.test.ts`))
		.sort();
	// Both projects collect every file. `fresh`, beta's `four` and beta's `idle` have no weight.
	const manifest: DurationManifest = {
		source: {
			commit: 'fixture',
			vitest: 'fixture',
			runner: 'fixture',
			coverage: false,
			workers: 2
		},
		durations: {
			'alpha:one.test.ts': 8,
			'beta:one.test.ts': 7,
			'alpha:two.test.ts': 3,
			'beta:two.test.ts': 3,
			'alpha:three.test.ts': 2,
			'beta:three.test.ts': 2,
			'alpha:four.test.ts': 1,
			'alpha:idle.test.ts': 5
		}
	};
	mkdirSync(join(fixture, 'scripts'));
	writeFileSync(join(fixture, DURATIONS_FILE), JSON.stringify(manifest));
	const project = (name: string) => ({ extends: true, test: { name, include: ['*.test.ts'] } });
	writeFileSync(
		join(fixture, 'vitest.config.ts'),
		[
			`import { DurationSequencer } from ${JSON.stringify(join(ROOT, 'scripts/duration-sequencer.ts'))};`,
			`export default { test: { globals: true, sequence: { sequencer: DurationSequencer }, projects: ${JSON.stringify([project('alpha'), project('beta')])} } };`
		].join('\n')
	);

	it('runs heavier files first within each project of a shard', async () => {
		const spec = (name: string, file: string) =>
			({
				project: { name, config: { root: fixture, sequence: { groupOrder: 0 }, isolate: true } },
				moduleId: join(fixture, file)
			}) as unknown as TestSpecification;
		const ctx = { config: { root: fixture, shard: { index: 1, count: 2 } } } as unknown as Vitest;
		const sorted = await new DurationSequencer(ctx).sort([
			spec('beta', 'one.test.ts'),
			spec('alpha', 'four.test.ts'),
			spec('alpha', 'fresh.test.ts'),
			spec('alpha', 'one.test.ts')
		]);
		// `fresh` weighs the manifest median, 3.
		expect(sorted.map((s) => `${s.project.name}:${s.moduleId.slice(fixture.length + 1)}`)).toEqual([
			'alpha:one.test.ts',
			'alpha:fresh.test.ts',
			'alpha:four.test.ts',
			'beta:one.test.ts'
		]);
	});

	/** Runs the fixture through the pinned Vitest CLI, failing the test `failing` names. */
	function run(label: string, args: string[] = [], failing = '') {
		const blob = join(fixture, 'reports', `${label}.json`);
		const result = spawnSync(
			process.execPath,
			[
				join(ROOT, 'node_modules/vitest/vitest.mjs'),
				'--run',
				'--maxWorkers=2',
				'--reporter=blob',
				`--outputFile.blob=${blob}`,
				...args
			],
			{
				cwd: fixture,
				encoding: 'utf8',
				timeout: 60_000,
				env: { ...process.env, FAIL_TEST: failing }
			}
		);
		const log = result.stderr + result.stdout;
		expect(existsSync(blob), log).toBe(true);
		const reported = readBlobReport(blob).files;
		return {
			blob,
			status: result.status,
			log,
			keys: reported.map((file) => file.key).sort(),
			notPassed: reported
				.filter((file) => !file.passed)
				.map((file) => file.key)
				.sort()
		};
	}

	/** Runs the required Unit Tests check on the result GitHub derives from the shard exits. */
	function unitTestsCheck(shardStatuses: Array<number | null>): number | null {
		const workflow = parseYaml(
			readFileSync(join(ROOT, '.github/workflows/static-checks.yml'), 'utf8')
		) as { jobs: Record<string, { name: string; steps: Array<{ run?: string }> }> };
		const script = Object.values(workflow.jobs)
			.find((job) => job.name === 'Unit Tests')
			?.steps.find((step) => step.run)?.run;
		if (!script) throw new Error('static-checks.yml has no Unit Tests check.');
		// A matrix job's result is `success` only when every shard succeeded.
		const result = shardStatuses.every((status) => status === 0) ? 'success' : 'failure';
		return spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
			env: { PATH: process.env.PATH, SHARD_RESULT: result },
			encoding: 'utf8',
			timeout: 5_000
		}).status;
	}

	it('splits a Vitest run into two shards whose union is the unsharded run', () => {
		const all = run('all');
		const first = run('shard-1', ['--shard=1/2']);
		const second = run('shard-2', ['--shard=2/2']);
		for (const { status, log } of [all, first, second]) expect(status, log).toBe(0);

		expect(all.keys).toEqual(keys);
		expect(first.keys.length).toBeGreaterThan(0);
		expect(second.keys.length).toBeGreaterThan(0);
		expect(first.keys.filter((key) => second.keys.includes(key))).toEqual([]);
		expect([...first.keys, ...second.keys].sort()).toEqual(keys);
		// The two heaviest weights belong to the same path in two projects.
		expect(first.keys.includes('alpha:one.test.ts')).not.toBe(
			first.keys.includes('beta:one.test.ts')
		);
		expect(unitTestsCheck([first.status, second.status])).toBe(0);
	}, 120_000);

	it('fails the shard that runs a failing test and the Unit Tests check', () => {
		const owners = ['alpha:one.test.ts', 'beta:one.test.ts'].map((failing, round) => {
			const shards = [1, 2].map((index) =>
				run(`failing-${round}-${index}`, [`--shard=${index}/2`], failing)
			);
			const owner = shards.findIndex((shard) => shard.keys.includes(failing));
			expect([...shards[0].keys, ...shards[1].keys].sort()).toEqual(keys);
			for (const [index, shard] of shards.entries()) {
				expect(shard.status, shard.log).toBe(index === owner ? 1 : 0);
				// Only the failing test and the skipped files did not pass.
				expect(shard.notPassed).toEqual(
					shard.keys.filter((key) => key === failing || key.endsWith(':idle.test.ts'))
				);
			}
			expect(unitTestsCheck(shards.map((shard) => shard.status))).toBe(1);
			return owner + 1;
		});
		// The failing test sat on shard 1, then on shard 2.
		expect(owners).toEqual([1, 2]);
	}, 120_000);

	it('refreshes only the weights of passed files that still exist', () => {
		const shards = [1, 2].map((index) =>
			run(`refresh-${index}`, [`--shard=${index}/2`], 'alpha:one.test.ts')
		);

		rmSync(join(fixture, 'three.test.ts'));
		const update = spawnSync(
			'bun',
			[
				join(ROOT, 'scripts/update-test-durations.ts'),
				`--root=${fixture}`,
				'--runner=fixture',
				'--commit=abc123',
				...shards.map((shard) => shard.blob)
			],
			{ encoding: 'utf8', timeout: 30_000 }
		);
		expect(update.status, update.stderr).toBe(0);
		const updated = JSON.parse(
			readFileSync(join(fixture, DURATIONS_FILE), 'utf8')
		) as DurationManifest;
		expect(updated.source).toMatchObject({
			commit: 'abc123',
			runner: 'fixture',
			coverage: false,
			workers: 2
		});
		// Beta's skipped `idle` had no weight to keep.
		expect(Object.keys(updated.durations)).toEqual(
			keys.filter((key) => !key.endsWith(':three.test.ts') && key !== 'beta:idle.test.ts')
		);
		// The failed and the skipped file keep their old weights; a passed file is measured anew.
		expect(updated.durations).toMatchObject({ 'alpha:one.test.ts': 8, 'alpha:idle.test.ts': 5 });
		expect(updated.durations['beta:one.test.ts']).not.toBe(7);
	}, 60_000);
});
