import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import type { Doc } from '../../convex/_generated/dataModel';
import type {
	MutationCtx as ConvexMutationCtx,
	QueryCtx as ConvexQueryCtx
} from '../../convex/_generated/server';
import databaseSchema from '../_generated/schema';
import { MutationCtx, QueryCtx } from '../_generated/services';
import promptStore from './promptStore.spec';

const activePrompts = (db: ConvexQueryCtx['db']) =>
	Effect.promise(() =>
		// eslint-disable-next-line @convex-dev/no-collect-in-query -- Bounded: at most one active row per locale, read through the by_active index
		db
			.query('supportAgentPrompts')
			.withIndex('by_active', (q) => q.eq('active', true))
			.collect()
	);

const deactivate = (db: ConvexMutationCtx['db'], rows: ReadonlyArray<Doc<'supportAgentPrompts'>>) =>
	Effect.forEach(
		rows,
		(row) => Effect.promise(() => db.patch('supportAgentPrompts', row._id, { active: false })),
		{ discard: true }
	);

export default GroupImpl.make(databaseSchema, promptStore).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, promptStore, 'getActive', ({ locale }) =>
			Effect.gen(function* () {
				const ctx = yield* QueryCtx;
				const active = yield* activePrompts(ctx.db);
				const exact = locale ? active.find((row) => row.locale === locale) : undefined;
				const fallback = active.find((row) => row.locale === undefined);
				return (exact ?? fallback ?? active[0])?.systemPrompt ?? null;
			})
		),
		FunctionImpl.make(databaseSchema, promptStore, 'savePrompt', ({ systemPrompt, locale, note }) =>
			Effect.gen(function* () {
				const ctx = yield* MutationCtx;
				const active = yield* activePrompts(ctx.db);
				yield* deactivate(
					ctx.db,
					active.filter((row) => row.locale === locale)
				);
				return yield* Effect.promise(() =>
					ctx.db.insert('supportAgentPrompts', {
						systemPrompt,
						...(locale !== undefined ? { locale } : {}),
						...(note !== undefined ? { note } : {}),
						active: true,
						createdAt: Date.now()
					})
				);
			})
		),
		FunctionImpl.make(databaseSchema, promptStore, 'setActive', ({ id, active }) =>
			Effect.gen(function* () {
				const ctx = yield* MutationCtx;
				if (active) {
					const target = yield* Effect.promise(() => ctx.db.get('supportAgentPrompts', id));
					if (target === null) return null;
					const siblings = yield* activePrompts(ctx.db);
					yield* deactivate(
						ctx.db,
						siblings.filter((row) => row._id !== id && row.locale === target.locale)
					);
				}
				yield* Effect.promise(() => ctx.db.patch('supportAgentPrompts', id, { active }));
				return null;
			})
		)
	]),
	GroupImpl.finalize
);
