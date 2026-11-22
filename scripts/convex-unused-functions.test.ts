import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GOLDENS_DIR } from '../src/lib/confect/goldens';
import { specInventory } from './convex-goldens';
import { projectSources, unusedFunctions } from './convex-unused-functions';

const notes = [
	{ group: 'notes', name: 'list' },
	{ group: 'notes', name: 'remove' }
];

describe('unused Convex functions', () => {
	it('match the committed list of functions nothing in the app calls', async () => {
		const known: unknown = JSON.parse(readFileSync(`${GOLDENS_DIR}/unused-functions.json`, 'utf8'));

		expect(unusedFunctions(await specInventory(), projectSources(process.cwd()))).toEqual(known);
	});

	it('report a function nothing references', () => {
		expect(
			unusedFunctions(notes, [
				{ file: 'src/routes/notes.svelte', source: 'useQuery(api.notes.list, {});' }
			])
		).toEqual(['notes:remove']);
	});

	it('count a reference through the Confect refs', () => {
		expect(
			unusedFunctions(notes, [
				{
					file: 'src/lib/confect/notes.ts',
					source: [
						"import refs from './_generated/refs';",
						'yield* scheduler.runAfter(0, refs.internal.notes.remove, {});',
						'yield* runQuery(refs.public.notes.list, {});'
					].join('\n')
				}
			])
		).toEqual([]);
	});

	it('count a module handed over as a whole', () => {
		expect(
			unusedFunctions(notes, [
				{ file: 'src/lib/confect/authServer.ts', source: 'const callbacks = internal.notes;' }
			])
		).toEqual([]);
	});

	it('ignore the generated declarations, tests and e2e specs', () => {
		expect(
			unusedFunctions(notes, [
				{
					file: 'src/lib/convex/_generated/api.d.ts',
					source: 'declare const fullApi: { notes: typeof api.notes.list };'
				},
				{
					file: 'src/lib/confect/_generated/registeredFunctions/notes.ts',
					source: 'export const remove = registeredFunctions.remove;'
				},
				{
					file: 'src/lib/confect/_generated/refs.ts',
					source: "import refs from './refs';\nrefs.public.notes.list;"
				},
				{ file: 'src/lib/confect/notes.test.ts', source: 't.query(api.notes.list, {});' },
				{ file: 'e2e/notes.spec.ts', source: 'client.mutation(api.notes.remove, {});' }
			])
		).toEqual(['notes:list', 'notes:remove']);
	});
});
