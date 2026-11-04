/**
 * Vitest sequencer that splits `--shard` runs by measured file cost instead of a path hash.
 *
 * Every shard discovers the same test files and reads the same committed weights from
 * scripts/test-durations.json, so each computes the same assignment and keeps its own part.
 * A file the manifest lacks weighs the manifest median, so new and renamed files still run
 * exactly once; stale weights cost balance, never coverage. Without `--shard` it is the
 * stock BaseSequencer. Refresh the weights with scripts/update-test-durations.ts.
 *
 * Scope: runtime projects in the default file order. It replaces Vitest's RandomSequencer,
 * so an explicit file shuffle (`sequence.shuffle`) is not honoured, sharded or not. A
 * typecheck spec that shares its project and path with a runtime spec is not supported.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { BaseSequencer, type TestSpecification } from 'vitest/node';

/** The manifest's location relative to the Vitest root. */
export const DURATIONS_FILE = 'scripts/test-durations.json';

export type DurationManifest = {
	/** The run the weights were measured on. */
	source: { commit: string; vitest: string; runner: string; coverage: boolean };
	/** Seconds per `<project>:<posix path relative to the project root>`. */
	durations: Record<string, number>;
};

export function testKey(project: string, file: string): string {
	return `${project}:${file.split(sep).join('/')}`;
}

/** The weight of keys the manifest lacks: its median, or one second when it is empty. */
function fallbackWeight(durations: Record<string, number>): number {
	const values = Object.values(durations).sort((a, b) => a - b);
	// The two middle values, one and the same for an odd count.
	const low = values[(values.length - 1) >> 1] ?? 1;
	const high = values[values.length >> 1] ?? 1;
	return (low + high) / 2;
}

/** Orders keys heaviest first, equal weights by key, so discovery order never matters. */
function heaviestFirst(durations: Record<string, number>) {
	const fallback = fallbackWeight(durations);
	const weight = (key: string) => durations[key] ?? fallback;
	const compare = (a: string, b: string) => weight(b) - weight(a) || (a < b ? -1 : a > b ? 1 : 0);
	return { weight, compare };
}

/**
 * Splits keys into `count` shards by longest processing time first: each key, heaviest
 * first, goes to the shard with the least total weight so far, the lowest index on a tie.
 * The same keys and durations give the same shards in any input order.
 */
export function assignShards(
	keys: readonly string[],
	durations: Record<string, number>,
	count: number
): string[][] {
	const { weight, compare } = heaviestFirst(durations);
	const shards = Array.from({ length: count }, () => ({ keys: [] as string[], load: 0 }));
	for (const key of [...keys].sort(compare)) {
		const lightest = shards.reduce((min, shard) => (shard.load < min.load ? shard : min));
		lightest.keys.push(key);
		lightest.load += weight(key);
	}
	return shards.map((shard) => shard.keys);
}

function specKey(spec: TestSpecification): string {
	return testKey(spec.project.name, relative(spec.project.config.root, spec.moduleId));
}

/** Set as the root `sequence.sequencer`; Vitest sequences every project with it. */
export class DurationSequencer extends BaseSequencer {
	#durations: Record<string, number> | undefined;

	#readDurations(): Record<string, number> {
		if (this.#durations) return this.#durations;
		const file = join(this.ctx.config.root, DURATIONS_FILE);
		this.#durations = existsSync(file)
			? (JSON.parse(readFileSync(file, 'utf8')) as DurationManifest).durations
			: {};
		return this.#durations;
	}

	override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
		// Vitest calls shard() only when `--shard` is set.
		const { index, count } = this.ctx.config.shard!;
		const keys = assignShards(files.map(specKey), this.#readDurations(), count)[index - 1];
		const mine = new Set(keys);
		return files.filter((spec) => mine.has(specKey(spec)));
	}

	/** BaseSequencer's group, project and isolation order; within it, longer files first. */
	override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
		if (!this.ctx.config.shard) return super.sort(files);
		const { compare } = heaviestFirst(this.#readDurations());
		return [...files].sort((a, b) => {
			const groupOrder =
				a.project.config.sequence.groupOrder - b.project.config.sequence.groupOrder;
			if (groupOrder !== 0) return groupOrder;
			if (a.project.name !== b.project.name) return a.project.name < b.project.name ? -1 : 1;
			if (a.project.config.isolate !== b.project.config.isolate) {
				return a.project.config.isolate ? -1 : 1;
			}
			return compare(specKey(a), specKey(b));
		});
	}
}
