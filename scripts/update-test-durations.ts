/**
 * Rewrites scripts/test-durations.json, the weights scripts/duration-sequencer.ts splits
 * unit test shards by, from the Vitest blob reports of one run.
 *
 * A file weighs the time Vitest tracks for it, rounded to centiseconds: environment setup,
 * worker preparation, setup files, collection (its imports) and the test run. Pass the
 * blobs of every shard of the same run; each Unit Tests job uploads its blob as the
 * `unit-test-blob-<n>-2` artifact. Only a passed file supplies a new weight. A failed,
 * skipped or unfinished file keeps its previous weight, if it has one, and files no longer
 * on disk or in any report drop out.
 *
 * Usage: bun scripts/update-test-durations.ts --runner <label> [--commit <sha>] [--root <dir>]
 *   [report files or directories, default .vitest-reports]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { RunnerTestFile } from 'vitest';
import { DURATIONS_FILE, testKey, type DurationManifest } from './duration-sequencer.ts';

/**
 * Decodes the flatted encoding the blob reporter writes: one JSON array whose first entry
 * is the value, where every string inside an object or array is the index of the entry
 * that holds it. Shared and circular references stay shared.
 */
function parseFlatted(text: string): unknown {
	const input = JSON.parse(text) as unknown[];
	const revived = new Map<number, unknown>();
	const revive = (index: number): unknown => {
		const value = input[index];
		if (typeof value !== 'object' || value === null) return value;
		if (revived.has(index)) return revived.get(index);
		// An array fills by string index like an object.
		const output = (Array.isArray(value) ? [] : {}) as Record<string, unknown>;
		revived.set(index, output);
		for (const [key, item] of Object.entries(value)) {
			output[key] = typeof item === 'string' ? revive(Number(item)) : item;
		}
		return output;
	};
	return revive(0);
}

export type BlobReport = {
	vitest: string;
	coverage: boolean;
	files: Array<{ key: string; seconds: number; passed: boolean }>;
};

/** The phases Vitest's duration summary adds up for a file. */
function trackedMilliseconds(file: RunnerTestFile): number {
	const { environmentLoad = 0, prepareDuration = 0, setupDuration = 0, collectDuration = 0 } = file;
	return (
		environmentLoad +
		prepareDuration +
		setupDuration +
		collectDuration +
		(file.result?.duration ?? 0)
	);
}

/** Reads one `--reporter=blob` file into project-qualified per-file costs. */
export function readBlobReport(path: string): BlobReport {
	const [vitest, files, , coverage] = parseFlatted(readFileSync(path, 'utf8')) as [
		string,
		RunnerTestFile[],
		unknown,
		unknown
	];
	if (typeof vitest !== 'string' || !Array.isArray(files)) {
		throw new Error(`${path} is not a Vitest blob report.`);
	}
	return {
		vitest,
		coverage: coverage != null,
		files: files.map((file) => ({
			key: testKey(file.projectName ?? '', file.name),
			seconds: Math.round(trackedMilliseconds(file) / 10) / 100,
			passed: file.result?.state === 'pass'
		}))
	};
}

function reportFiles(paths: string[]): string[] {
	return paths.flatMap((path) =>
		statSync(path).isDirectory()
			? readdirSync(path)
					.filter((name) => name.endsWith('.json'))
					.sort()
					.map((name) => join(path, name))
			: [path]
	);
}

/**
 * Builds the manifest for `root` from the blobs of one run. `previous` supplies the weight
 * of files that did not pass.
 */
function buildManifest(options: {
	root: string;
	reports: BlobReport[];
	previous: Record<string, number>;
	commit: string;
	runner: string;
}): DurationManifest {
	const { root, reports, previous } = options;
	const [vitest, ...otherVersions] = new Set(reports.map((report) => report.vitest));
	if (vitest === undefined || otherVersions.length > 0) {
		throw new Error('Pass the blob reports of one run, made by one Vitest version.');
	}
	const seen = new Set<string>();
	const durations = new Map<string, number>();
	for (const file of reports.flatMap((report) => report.files)) {
		if (seen.has(file.key)) {
			throw new Error(`${file.key} appears in two reports; pass the shards of one run.`);
		}
		seen.add(file.key);
		const seconds = file.passed ? file.seconds : previous[file.key];
		const path = file.key.slice(file.key.indexOf(':') + 1);
		if (seconds !== undefined && existsSync(join(root, path))) durations.set(file.key, seconds);
	}
	return {
		source: {
			commit: options.commit,
			vitest,
			runner: options.runner,
			coverage: reports.some((report) => report.coverage)
		},
		durations: Object.fromEntries([...durations].sort(([a], [b]) => (a < b ? -1 : 1)))
	};
}

if (import.meta.main) {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			runner: { type: 'string' },
			commit: { type: 'string' },
			root: { type: 'string', default: join(import.meta.dirname, '..') }
		}
	});
	if (!values.runner) {
		throw new Error('Pass --runner with the runner class the reports ran on.');
	}
	const root = resolve(values.root);
	const output = join(root, DURATIONS_FILE);
	const previous = existsSync(output)
		? (JSON.parse(readFileSync(output, 'utf8')) as DurationManifest).durations
		: {};
	const reports = reportFiles(positionals.length > 0 ? positionals : ['.vitest-reports']);
	const manifest = buildManifest({
		root,
		reports: reports.map(readBlobReport),
		previous,
		commit:
			values.commit ??
			execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
		runner: values.runner
	});
	writeFileSync(output, `${JSON.stringify(manifest, null, '\t')}\n`);
	console.log(
		`Wrote ${Object.keys(manifest.durations).length} weights from ${reports.length} reports to ${output}.`
	);
}
