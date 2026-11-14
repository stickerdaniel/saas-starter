import * as fs from 'node:fs';
import * as path from 'node:path';
import { glob } from 'tinyglobby';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { configDefaults } from 'vitest/config';
import {
	BaseSequencer,
	type ResolvedConfig,
	type TestProject,
	type TestSequencerConstructor,
	type TestSpecification,
	type Vitest
} from 'vitest/node';
import { parse as parseYaml } from 'yaml';
import { HEAVY_TOOLING_SUITES, HeavySuiteSequencer } from './vitest-sequencer';
import { sharedTestSettings, toolingTestSettings } from './vitest-settings';

const ROOT = path.resolve(import.meta.dirname, '..');
const STATIC_CHECKS = /^scripts\/static-checks[^/]*\.test\.ts$/;

/**
 * The test files of each project in vite.config.ts, globbed the way Vitest 5.0.5 does
 * (`globProjectFiles`). Both projects extend the root settings, so the tooling exclude adds to
 * the shared one; the app include repeats the app project's in vite.config.ts.
 */
const PROJECTS = [
	{
		name: toolingTestSettings.name,
		include: configDefaults.include,
		exclude: [...sharedTestSettings.exclude, ...toolingTestSettings.exclude]
	},
	{
		name: 'app',
		include: configDefaults.include.map((pattern) => `src/${pattern}`),
		exclude: sharedTestSettings.exclude
	}
];

/**
 * A specification with the fields the sequencers read: `moduleId` (`BaseSequencer.shard`),
 * `project.name` (`HeavySuiteSequencer.shard`) and `pool` (the completeness key below).
 */
function specification(project: string, moduleId: string): TestSpecification {
	const spec = { moduleId, pool: 'forks', project: { name: project } } satisfies Pick<
		TestSpecification,
		'moduleId' | 'pool'
	> & { project: Pick<TestProject, 'name'> };
	return spec as unknown as TestSpecification;
}

/** The part of the Vitest context that `shard` reads. */
function shardContext(index: number, count: number): Vitest {
	const ctx = { config: { root: ROOT, shard: { index, count } } } satisfies {
		config: Pick<ResolvedConfig, 'root' | 'shard'>;
	};
	return ctx as unknown as Vitest;
}

const specs = (
	await Promise.all(
		PROJECTS.map(async ({ name, include, exclude }) =>
			(
				await glob([...include], {
					dot: true,
					cwd: ROOT,
					ignore: [...exclude],
					expandDirectories: false
				})
			).map((file) => specification(name, path.resolve(ROOT, file).replaceAll('\\', '/')))
		)
	)
).flat();

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

/** Runs `shard` for every index of `count`, the way one CI job per index would. */
async function partition(
	Sequencer: TestSequencerConstructor,
	files: TestSpecification[],
	count: number
): Promise<TestSpecification[][]> {
	const shards: TestSpecification[][] = [];
	for (let index = 1; index <= count; index++) {
		shards.push(await new Sequencer(shardContext(index, count)).shard([...files]));
	}
	return shards;
}

const keys = (shards: TestSpecification[][], keep: (spec: TestSpecification) => boolean) =>
	shards.map((shard) => shard.filter(keep).map(key).sort());

/** The value of the property `name` when `node` is an object literal. */
function property(node: ts.Node | undefined, name: string): ts.Expression | undefined {
	if (!node || !ts.isObjectLiteralExpression(node)) return undefined;
	return node.properties.find(
		(entry): entry is ts.PropertyAssignment =>
			ts.isPropertyAssignment(entry) && entry.name.getText() === name
	)?.initializer;
}

describe('heavy suite sequencer', () => {
	it('is the sequencer of the root Vitest config', () => {
		const configPath = path.join(ROOT, 'vite.config.ts');
		const source = ts.createSourceFile(
			configPath,
			fs.readFileSync(configPath, 'utf-8'),
			ts.ScriptTarget.Latest,
			true
		);
		const imported = source.statements.some((statement) => {
			if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
				return false;
			}
			const bindings = statement.importClause?.namedBindings;
			return (
				/^\.\/scripts\/vitest-sequencer(\.ts)?$/.test(statement.moduleSpecifier.text) &&
				!statement.importClause?.isTypeOnly &&
				bindings !== undefined &&
				ts.isNamedImports(bindings) &&
				bindings.elements.some(
					(element) =>
						!element.isTypeOnly &&
						!element.propertyName &&
						element.name.text === HeavySuiteSequencer.name
				)
			);
		});
		expect(imported, `vite.config.ts imports ${HeavySuiteSequencer.name}`).toBe(true);

		const rootTests: ts.Expression[] = [];
		const visit = (node: ts.Node): void => {
			if (
				ts.isPropertyAssignment(node) &&
				node.name.getText() === 'test' &&
				property(node.initializer, 'projects')
			) {
				rootTests.push(node.initializer);
			}
			ts.forEachChild(node, visit);
		};
		visit(source);
		expect(rootTests).toHaveLength(1);
		const sequencer = property(property(rootTests[0], 'sequence'), 'sequencer');
		expect(sequencer?.getText()).toBe(HeavySuiteSequencer.name);
	});

	it('lists every static-checks suite and each named extra once', () => {
		const tooling = specs.filter(isTooling).map(relative);
		expect(new Set(HEAVY_TOOLING_SUITES).size, 'duplicate entries').toBe(
			HEAVY_TOOLING_SUITES.length
		);
		expect(HEAVY_TOOLING_SUITES.filter((file) => STATIC_CHECKS.test(file)).sort()).toEqual(
			tooling.filter((file) => STATIC_CHECKS.test(file)).sort()
		);
		expect(
			HEAVY_TOOLING_SUITES.filter((file) => !tooling.includes(file)),
			'listed suites that are not tooling test files'
		).toEqual([]);
	});

	describe.each(COUNTS)('with %i shards', (count) => {
		it('runs every tooling spec exactly once and spreads the heavy suites', async () => {
			const tooling = specs.filter(isTooling);
			const shards = await partition(HeavySuiteSequencer, tooling, count);
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

		it('deals the heavy suites to shards 1..n, then n..1, and so on', async () => {
			const shards = await partition(HeavySuiteSequencer, specs.filter(isTooling), count);
			const forward = Array.from({ length: count }, (_, index) => index + 1);
			const rounds = Math.ceil(HEAVY_TOOLING_SUITES.length / count);
			const expected = Array.from({ length: rounds }, (_, round) =>
				round % 2 === 0 ? forward : [...forward].reverse()
			).flat();
			const dealt = HEAVY_TOOLING_SUITES.map(
				(file) => shards.findIndex((shard) => shard.some((spec) => relative(spec) === file)) + 1
			);
			expect(dealt).toEqual(expected.slice(0, HEAVY_TOOLING_SUITES.length));
		});

		it('places app specs as BaseSequencer does, alone or mixed with tooling', async () => {
			const app = specs.filter((spec) => !isTooling(spec));
			const base = keys(await partition(BaseSequencer, app, count), () => true);
			expect(keys(await partition(HeavySuiteSequencer, app, count), () => true)).toEqual(base);

			const mixed = await partition(HeavySuiteSequencer, specs, count);
			expect(mixed.flat().map(key).sort()).toEqual(specs.map(key).sort());
			expect(keys(mixed, (spec) => !isTooling(spec))).toEqual(base);
			expect(keys(mixed, isTooling)).toEqual(
				keys(await partition(HeavySuiteSequencer, specs.filter(isTooling), count), () => true)
			);
		});
	});
});
