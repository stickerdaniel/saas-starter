import { describe, it, expect } from 'vitest';
import { getActive, savePrompt, setActive } from '../promptStore';

/**
 * Handler-level unit tests (the codebase idiom): each Convex fn exposes its
 * handler under `_handler`, driven here against a tiny in-memory db so the
 * activation lifecycle (one active row per locale, exact-locale wins) is
 * exercised end-to-end rather than asserted on mock call counts.
 */

type Row = {
	_id: string;
	systemPrompt: string;
	locale?: string;
	note?: string;
	active: boolean;
	createdAt: number;
};

// Minimal Convex db double: just enough of query/withIndex/collect/insert/patch/get
// for promptStore. withIndex applies the recorded eq() constraints against the rows.
function makeDb() {
	const rows: Row[] = [];
	let counter = 0;
	const db = {
		rows,
		query: (_table: string) => ({
			withIndex: (
				_index: string,
				cb: (q: { eq: (field: string, value: unknown) => unknown }) => unknown
			) => {
				const filters: Array<[string, unknown]> = [];
				const q = {
					eq: (field: string, value: unknown) => {
						filters.push([field, value]);
						return q;
					}
				};
				cb(q);
				return {
					collect: async () =>
						rows.filter((row) =>
							filters.every(([field, value]) => (row as Record<string, unknown>)[field] === value)
						)
				};
			}
		}),
		insert: async (_table: string, doc: Omit<Row, '_id'>) => {
			const _id = `prompt_${++counter}`;
			rows.push({ _id, ...doc });
			return _id;
		},
		patch: async (id: string, patch: Partial<Row>) => {
			const row = rows.find((r) => r._id === id);
			if (row) Object.assign(row, patch);
		},
		get: async (id: string) => rows.find((r) => r._id === id) ?? null
	};
	return db;
}

type Fn<A, R> = { _handler: (ctx: unknown, args: A) => Promise<R> };
const getActiveH = getActive as unknown as Fn<{ locale?: string }, string | null>;
const savePromptH = savePrompt as unknown as Fn<
	{ systemPrompt: string; locale?: string; note?: string },
	string
>;
const setActiveH = setActive as unknown as Fn<{ id: string; active: boolean }, null>;

const activeRows = (db: ReturnType<typeof makeDb>) => db.rows.filter((r) => r.active);

describe('support promptStore', () => {
	it('returns null when no prompt is active (falls back to the seed)', async () => {
		const db = makeDb();
		expect(await getActiveH._handler({ db }, {})).toBeNull();
	});

	it('serves a saved prompt and marks it active', async () => {
		const db = makeDb();
		await savePromptH._handler({ db }, { systemPrompt: 'v1' });

		expect(db.rows).toHaveLength(1);
		expect(db.rows[0].active).toBe(true);
		expect(await getActiveH._handler({ db }, {})).toBe('v1');
	});

	it('persists an optional note without affecting resolution', async () => {
		const db = makeDb();
		await savePromptH._handler(
			{ db },
			{ systemPrompt: 'v1', note: 'from 2026-07 optimization run' }
		);

		expect(db.rows[0].note).toBe('from 2026-07 optimization run');
		expect(await getActiveH._handler({ db }, {})).toBe('v1');
	});

	it('activating a new prompt deactivates the previous one for the same locale', async () => {
		const db = makeDb();
		await savePromptH._handler({ db }, { systemPrompt: 'v1' });
		await savePromptH._handler({ db }, { systemPrompt: 'v2' });

		expect(activeRows(db)).toHaveLength(1);
		expect(activeRows(db)[0].systemPrompt).toBe('v2');
		expect(await getActiveH._handler({ db }, {})).toBe('v2');
	});

	it('prefers an exact-locale prompt over the locale-less default', async () => {
		const db = makeDb();
		await savePromptH._handler({ db }, { systemPrompt: 'global' });
		await savePromptH._handler({ db }, { systemPrompt: 'german', locale: 'de' });

		// Different locales, so both stay active.
		expect(activeRows(db)).toHaveLength(2);
		expect(await getActiveH._handler({ db }, { locale: 'de' })).toBe('german');
		// An unmatched locale falls back to the locale-less default.
		expect(await getActiveH._handler({ db }, { locale: 'fr' })).toBe('global');
		// No locale requested serves the locale-less default.
		expect(await getActiveH._handler({ db }, {})).toBe('global');
	});

	it('scopes savePrompt deactivation to the same locale', async () => {
		const db = makeDb();
		await savePromptH._handler({ db }, { systemPrompt: 'global' });
		await savePromptH._handler({ db }, { systemPrompt: 'de-v1', locale: 'de' });
		// Re-saving the de override deactivates only the prior de row, not global.
		await savePromptH._handler({ db }, { systemPrompt: 'de-v2', locale: 'de' });

		expect(
			activeRows(db)
				.map((r) => r.systemPrompt)
				.sort()
		).toEqual(['de-v2', 'global']);
		expect(await getActiveH._handler({ db }, {})).toBe('global');
		expect(await getActiveH._handler({ db }, { locale: 'de' })).toBe('de-v2');
	});

	it('setActive deactivates same-locale siblings when activating a row', async () => {
		const db = makeDb();
		const id1 = await savePromptH._handler({ db }, { systemPrompt: 'v1' });
		await savePromptH._handler({ db }, { systemPrompt: 'v2' });
		// v2 is now active, v1 is not. Roll back to v1.
		await setActiveH._handler({ db }, { id: id1, active: true });

		expect(activeRows(db)).toHaveLength(1);
		expect(activeRows(db)[0]._id).toBe(id1);
		expect(await getActiveH._handler({ db }, {})).toBe('v1');
	});

	it('setActive leaves other locales active when activating one locale', async () => {
		const db = makeDb();
		await savePromptH._handler({ db }, { systemPrompt: 'global' });
		const deId1 = await savePromptH._handler({ db }, { systemPrompt: 'de-v1', locale: 'de' });
		await savePromptH._handler({ db }, { systemPrompt: 'de-v2', locale: 'de' });
		// global + de-v2 active. Re-activate de-v1; global must stay untouched.
		await setActiveH._handler({ db }, { id: deId1, active: true });

		expect(
			activeRows(db)
				.map((r) => r.systemPrompt)
				.sort()
		).toEqual(['de-v1', 'global']);
		expect(await getActiveH._handler({ db }, {})).toBe('global');
		expect(await getActiveH._handler({ db }, { locale: 'de' })).toBe('de-v1');
	});

	it('deactivating the live row rolls back to the seed fallback', async () => {
		const db = makeDb();
		const id = await savePromptH._handler({ db }, { systemPrompt: 'v1' });
		await setActiveH._handler({ db }, { id, active: false });

		expect(activeRows(db)).toHaveLength(0);
		expect(await getActiveH._handler({ db }, {})).toBeNull();
	});
});
