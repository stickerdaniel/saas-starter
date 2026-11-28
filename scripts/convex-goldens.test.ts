import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GOLDENS_DIR, goldenText } from '../src/lib/confect/goldens';
import {
	API_TYPES_FIXTURE,
	apiTypeFixtureIdentifiers,
	inventoryGolden,
	orphanedExports,
	scheduledTargets,
	specInventory
} from './convex-goldens';
import { freshSurfaceOf } from './convex-surface';

const golden = (name: string) => `../${GOLDENS_DIR}/${name}`;

function entriesOf(value: unknown): Array<[string, unknown]> {
	return typeof value === 'object' && value !== null ? Object.entries(value) : [];
}

function publishedRegistrations(): string[] {
	const parsed: unknown = JSON.parse(readFileSync(`${GOLDENS_DIR}/registrations.json`, 'utf8'));
	const modules = entriesOf(parsed).find(([key]) => key === 'modules')?.[1];
	return entriesOf(modules)
		.flatMap(([module, functions]) =>
			entriesOf(functions).map(([name, row]) => {
				const [visibility, kind]: unknown[] = Array.isArray(row) ? row : [];
				return `${module}:${name} ${String(visibility)} ${String(kind)}`;
			})
		)
		.sort();
}

function registeredNames(): Map<string, Set<string>> {
	const registrations = new Map<string, Set<string>>();
	for (const { group, name } of functions) {
		registrations.set(group, (registrations.get(group) ?? new Set()).add(name));
	}
	return registrations;
}

const functions = await specInventory(path.resolve(import.meta.dirname, '..'));
const surface = await freshSurfaceOf('src/lib/convex');

const trees: string[] = [];

afterEach(() => {
	for (const tree of trees.splice(0)) rmSync(tree, { recursive: true, force: true });
});

function treeWith(files: Record<string, string>): string {
	const root = mkdtempSync(path.join(tmpdir(), 'convex-goldens-'));
	trees.push(root);
	mkdirSync(path.join(root, 'src/lib/convex'), { recursive: true });
	for (const [file, content] of Object.entries(files)) {
		writeFileSync(path.join(root, file), content);
	}
	return root;
}

describe('Convex goldens', () => {
	it('refuse a native module whose export * forwards names the inventory cannot see', () => {
		const root = treeWith({
			'src/lib/convex/notes.ts':
				"export { list } from '../confect/notes';\nexport * from './helpers';\n",
			'src/lib/convex/helpers.ts': 'export const helper = 1;\n'
		});

		expect(() => orphanedExports(new Map([['notes', new Set(['list'])]]), root)).toThrow(
			"src/lib/convex/notes.ts forwards export * from './helpers';"
		);
	});

	it('keep the committed spec set', async () => {
		await expect(await goldenText(inventoryGolden(functions))).toMatchFileSnapshot(
			golden('inventory.json')
		);
	}, 60_000);

	it('leave no export beside the registered functions in a module the CLI owns', () => {
		expect(orphanedExports(registeredNames())).toEqual([]);
	});

	it('report an authored helper left in a generated module and in an entry file', () => {
		const root = treeWith({
			'src/lib/convex/notes.ts':
				'import registeredFunctions from "../confect/_generated/registeredFunctions/notes";\n\nexport const list = registeredFunctions.list;\nexport function helper() {}\n',
			'src/lib/convex/http.ts':
				'import http from "../confect/http";\nexport type Route = string;\nexport default http;\n'
		});

		expect(orphanedExports(new Map([['notes', new Set(['list'])]]), root)).toEqual([
			'src/lib/convex/http:Route',
			'src/lib/convex/notes:helper'
		]);
	});

	it('publish exactly the functions of the committed spec set', () => {
		const specified = functions
			.map(({ group, name, visibility, kind }) => `${group}:${name} ${visibility} ${kind}`)
			.sort();

		expect(publishedRegistrations()).toEqual(specified);
	});

	it('keep the scheduled targets the compatibility check resolves', async () => {
		await expect(await goldenText(scheduledTargets(surface))).toMatchFileSnapshot(
			golden('scheduled-targets.json')
		);
	}, 60_000);

	it('give every published function a compile-time type golden', () => {
		const published = [...surface.keys()].sort();

		expect(apiTypeFixtureIdentifiers(readFileSync(API_TYPES_FIXTURE, 'utf8'))).toEqual(published);
	});
});
