/**
 * Vitest sequencer that splits `--shard` runs by measured file cost instead of a path hash.
 *
 * Every shard discovers the same test files and reads the same committed weights from
 * scripts/test-durations.json, so each computes the same assignment and keeps its own part.
 * A file the manifest lacks weighs the manifest median, so new and renamed files still run
 * exactly once; stale weights cost balance, never coverage. Without `--shard` it is the
 * stock BaseSequencer. Refresh the weights with scripts/update-test-durations.ts.
 *
 * The split balances estimated wall time, not summed file time. Vitest runs a shard's
 * projects one after another, each over the shard's workers, so a project takes its
 * longest file or its total divided by the workers, whichever is longer.
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
	source: {
		commit: string;
		vitest: string;
		runner: string;
		coverage: boolean;
		/** Vitest workers per shard on that runner. */
		workers: number;
	};
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

type ProjectLoad = { total: number; longest: number };

/** A shard's estimated wall time: its projects in sequence, each spread over `workers`. */
function wallTime(loads: Map<string, ProjectLoad>, workers: number): number {
	let time = 0;
	for (const { total, longest } of loads.values()) time += Math.max(longest, total / workers);
	return time;
}

/**
 * Splits keys into `count` shards. Each key, heaviest first, goes to the shard that keeps
 * the longest estimated wall time of all shards smallest, then to the shard whose own time
 * grows least, so a file fills idle workers before it lengthens a shard, then to the lowest
 * index. The same keys, durations and workers give the
 * same shards in any input order.
 */
export function assignShards(
	keys: readonly string[],
	durations: Record<string, number>,
	count: number,
	workers: number
): string[][] {
	const { weight, compare } = heaviestFirst(durations);
	const shards = Array.from({ length: count }, () => ({
		keys: [] as string[],
		loads: new Map<string, ProjectLoad>(),
		time: 0
	}));
	for (const key of [...keys].sort(compare)) {
		const project = key.slice(0, key.indexOf(':'));
		const cost = weight(key);
		const options = shards.map((shard) => {
			const load = shard.loads.get(project) ?? { total: 0, longest: 0 };
			const loads = new Map(shard.loads).set(project, {
				total: load.total + cost,
				longest: Math.max(load.longest, cost)
			});
			const time = wallTime(loads, workers);
			const longest = Math.max(time, ...shards.map((other) => (other === shard ? 0 : other.time)));
			return { shard, loads, time, longest, growth: time - shard.time };
		});
		const best = options.reduce((min, option) =>
			option.longest < min.longest || (option.longest === min.longest && option.growth < min.growth)
				? option
				: min
		);
		best.shard.keys.push(key);
		best.shard.loads = best.loads;
		best.shard.time = best.time;
	}
	return shards.map((shard) => shard.keys);
}

function specKey(spec: TestSpecification): string {
	return testKey(spec.project.name, relative(spec.project.config.root, spec.moduleId));
}

/** Set as the root `sequence.sequencer`; Vitest sequences every project with it. */
export class DurationSequencer extends BaseSequencer {
	#manifest: { durations: Record<string, number>; workers: number } | undefined;

	#readManifest() {
		if (this.#manifest) return this.#manifest;
		const file = join(this.ctx.config.root, DURATIONS_FILE);
		const manifest = existsSync(file)
			? (JSON.parse(readFileSync(file, 'utf8')) as DurationManifest)
			: undefined;
		this.#manifest = {
			durations: manifest?.durations ?? {},
			workers: manifest?.source.workers ?? 1
		};
		return this.#manifest;
	}

	override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
		// Vitest calls shard() only when `--shard` is set.
		const { index, count } = this.ctx.config.shard!;
		const { durations, workers } = this.#readManifest();
		const keys = assignShards(files.map(specKey), durations, count, workers)[index - 1];
		const mine = new Set(keys);
		return files.filter((spec) => mine.has(specKey(spec)));
	}

	/** BaseSequencer's group, project and isolation order; within it, longer files first. */
	override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
		if (!this.ctx.config.shard) return super.sort(files);
		const { compare } = heaviestFirst(this.#readManifest().durations);
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
