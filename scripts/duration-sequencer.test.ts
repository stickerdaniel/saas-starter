import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { TestSpecification, Vitest } from 'vitest/node';
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
		const shards = assignShards(keys, durations, count);
		expect(shards).toHaveLength(count);
		for (const shard of shards) expect(shard.length).toBeGreaterThan(0);
		expect(shards.flat().sort()).toEqual([...keys].sort());
	});

	it('runs a file the manifest lacks on exactly one shard', () => {
		const keys = ['app:a.test.ts', 'app:b.test.ts', 'app:new.test.ts'];
		const shards = assignShards(keys, { 'app:a.test.ts': 4, 'app:b.test.ts': 2 }, 2);
		expect(shards.filter((shard) => shard.includes('app:new.test.ts'))).toHaveLength(1);
		expect(shards.flat()).toHaveLength(3);
	});

	it('gives the same shards for keys discovered in any order', () => {
		const equal = Object.fromEntries(keys.map((key) => [key, 1]));
		const reversed = [...keys].reverse();
		expect(assignShards(reversed, equal, 2)).toEqual(assignShards(keys, equal, 2));
		expect(assignShards(reversed, durations, 3)).toEqual(assignShards(keys, durations, 3));
	});

	it('balances measured cost rather than file count', () => {
		const quick = Array.from({ length: 5 }, (_, i) => `app:quick-${i}.test.ts`);
		const skewed = { 'app:slow.test.ts': 100, ...Object.fromEntries(quick.map((key) => [key, 1])) };
		expect(assignShards(Object.keys(skewed), skewed, 2)).toEqual([['app:slow.test.ts'], quick]);
	});
});

describe('DurationSequencer', () => {
	const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'duration-sequencer-')));
	afterAll(() => rmSync(fixture, { recursive: true, force: true }));

	const files = ['one', 'two', 'three', 'four', 'fresh'];
	for (const name of files) {
		writeFileSync(join(fixture, `${name}.test.ts`), `test('${name}', () => {});\n`);
	}
	// Both projects collect every file. `fresh` and beta's `four` have no weight.
	const manifest: DurationManifest = {
		source: { commit: 'fixture', vitest: 'fixture', runner: 'fixture', coverage: false },
		durations: {
			'alpha:one.test.ts': 8,
			'beta:one.test.ts': 7,
			'alpha:two.test.ts': 3,
			'beta:two.test.ts': 3,
			'alpha:three.test.ts': 2,
			'beta:three.test.ts': 2,
			'alpha:four.test.ts': 1
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

	/** Runs the fixture through the pinned Vitest CLI and returns the executed test keys. */
	function run(label: string, args: string[] = []): string[] {
		const blob = join(fixture, 'reports', `${label}.json`);
		const result = spawnSync(
			process.execPath,
			[
				join(ROOT, 'node_modules/vitest/vitest.mjs'),
				'--run',
				'--reporter=blob',
				`--outputFile.blob=${blob}`,
				...args
			],
			{ cwd: fixture, encoding: 'utf8', timeout: 60_000 }
		);
		expect(result.status, result.stderr + result.stdout).toBe(0);
		return readBlobReport(blob)
			.files.map((file) => file.key)
			.sort();
	}

	it('splits a Vitest run into two shards whose union is the unsharded run', () => {
		const all = run('all');
		const first = run('shard-1', ['--shard=1/2']);
		const second = run('shard-2', ['--shard=2/2']);

		expect(all).toHaveLength(files.length * 2);
		expect(first.length).toBeGreaterThan(0);
		expect(second.length).toBeGreaterThan(0);
		expect(first.filter((key) => second.includes(key))).toEqual([]);
		expect([...first, ...second].sort()).toEqual(all);
		// The two heaviest weights belong to the same path in two projects.
		expect(first.includes('alpha:one.test.ts')).not.toBe(first.includes('beta:one.test.ts'));

		rmSync(join(fixture, 'three.test.ts'));
		const update = spawnSync(
			'bun',
			[
				join(ROOT, 'scripts/update-test-durations.ts'),
				`--root=${fixture}`,
				'--runner=fixture',
				'--commit=abc123',
				join(fixture, 'reports/shard-1.json'),
				join(fixture, 'reports/shard-2.json')
			],
			{ encoding: 'utf8', timeout: 30_000 }
		);
		expect(update.status, update.stderr).toBe(0);
		const updated = JSON.parse(
			readFileSync(join(fixture, DURATIONS_FILE), 'utf8')
		) as DurationManifest;
		expect(updated.source).toMatchObject({ commit: 'abc123', runner: 'fixture', coverage: false });
		expect(Object.keys(updated.durations)).toEqual(
			all.filter((key) => !key.endsWith(':three.test.ts'))
		);
	}, 120_000);
});
