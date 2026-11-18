import { Linter } from 'eslint';
import { parser } from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import rule from './convex-access-first.js';

const linter = new Linter({ configType: 'flat' });
const config = [
	{
		files: ['**/*.ts'],
		languageOptions: { parser },
		plugins: { local: { rules: { 'convex-access-first': rule } } },
		rules: {
			'local/convex-access-first': [
				'error' as const,
				{
					pattern: '^(require|assert|ensure)([A-Z_]|$)|^publicEndpoint$',
					synchronous: ['publicEndpoint', 'requireTestSecret']
				}
			]
		}
	}
];

function lintHandler(handler: string, builder = 'mutation') {
	const code = `export const f = ${builder}({ args: {}, returns: v.null(), handler: ${handler} });`;
	return linter
		.verify(code, config, { filename: 'src/lib/convex/notes.ts' })
		.map(({ messageId, line }) => ({ messageId, line }));
}

const lint = (body: string, builder = 'mutation') =>
	lintHandler(`async (ctx, args) => {\n${body}\n}`, builder);

describe('convex-access-first', () => {
	it.each([
		['an awaited guard statement', 'await requireUser(ctx);\nawait ctx.db.insert("notes", {});'],
		[
			'a guard bound by one const declarator',
			'const access = await requireUser(ctx);\nawait ctx.db.insert("notes", { owner: access.id });'
		],
		[
			'a destructuring guard declaration',
			'const { user } = await requireUser(ctx);\nawait ctx.db.insert("notes", { owner: user.id });'
		],
		[
			'a listed synchronous guard',
			'requireTestSecret(args.secret);\nawait ctx.db.insert("notes", {});'
		],
		[
			'a read that finds the resource before the guard',
			'const note = await ctx.db.get("notes", args.id);\nawait requireOwner(ctx, note);\nawait ctx.db.patch("notes", args.id, {});'
		],
		[
			'an early exit that reaches no effect before the guard',
			'if (!args.id) return null;\nawait requireUser(ctx);\nawait ctx.db.delete("notes", args.id);'
		],
		['a public endpoint marker', 'publicEndpoint("Every visitor reads this.");\nreturn null;']
	])('passes %s', (_label, body) => {
		expect(lint(body)).toEqual([]);
	});

	it('leaves internal registrations alone', () => {
		expect(
			lint('await ctx.db.insert("notes", {});\nrequireUser(ctx);', 'internalMutation')
		).toEqual([]);
	});

	it.each([
		['an if test', 'if (!(await requireUser(ctx))) throw new Error("denied");'],
		[
			'a short-circuit',
			'if (args.needsCheck && !(await requireAuth(ctx))) return null;\nawait ctx.db.delete("chats", args.chatId);'
		],
		['a branch', 'if (args.check) await requireUser(ctx);'],
		['a loop body', 'for (const id of args.ids) await requireOwner(ctx, id);'],
		['a try block', 'try {\n\tawait requireUser(ctx);\n} catch {}'],
		['a nested function', 'const check = async () => await requireUser(ctx);\nawait check();'],
		['a returned call', 'return await requireUser(ctx);'],
		['a let declaration', 'let access = await requireUser(ctx);'],
		[
			'an optional call',
			'const requireMaybeUser = args.check ? requireUser : undefined;\nawait requireMaybeUser?.(ctx);'
		],
		[
			'an optional receiver',
			'const guards = args.check ? { requireUser } : undefined;\nawait guards?.requireUser(ctx);'
		],
		[
			'a declaration with several declarators',
			'const deleted = await ctx.db.delete("chats", args.chatId),\n\tuser = await requireAuth(ctx);'
		]
	])('reports a guard call only in %s', (_label, body) => {
		expect(lint(body)).toContainEqual({ messageId: 'missingGuard', line: 1 });
	});

	it('reports an expression-bodied handler', () => {
		expect(lintHandler('async (ctx) => requireUser(ctx)', 'query')).toEqual([
			{ messageId: 'missingGuard', line: 1 }
		]);
	});

	it('reports a guard that is not awaited', () => {
		expect(lint('requireUser(ctx);\nreturn "private";', 'query')).toEqual([
			{ messageId: 'missingGuard', line: 1 },
			{ messageId: 'notAwaited', line: 2 }
		]);
	});

	it.each([
		['ctx.runMutation', 'await ctx.runMutation(internal.notes.touch, {});'],
		['ctx.runAction', 'await ctx.runAction(internal.notes.send, {});'],
		['ctx.db.insert', 'await ctx.db.insert("notes", {});'],
		['ctx.db.delete', 'await ctx.db.delete("notes", args.id);'],
		['ctx.scheduler', 'await ctx.scheduler.runAfter(0, internal.notes.send, {});'],
		['ctx.storage.store', 'await ctx.storage.store(blob);'],
		['fetch', 'await fetch("https://example.com");'],
		['a non-null fetch', 'await fetch!("https://example.com");'],
		['an asserted fetch', 'await (fetch as typeof fetch)("https://example.com");'],
		['a computed db method', 'await ctx.db["insert"]("notes", {});'],
		['a template-literal db method', 'await ctx.db[`patch`]("notes", args.id, {});'],
		[
			'an effect inside an earlier branch',
			'if (args.fast) {\n\tawait ctx.db.insert("notes", {});\n}'
		]
	])('reports %s before the guard statement', (_label, effect) => {
		const messages = lint(`${effect}\nawait requireUser(ctx);\nreturn null;`, 'action');
		expect(messages).toHaveLength(1);
		expect(messages[0].messageId).toBe('effectBeforeGuard');
	});

	it('reports an effect in the expression that computes the guard', () => {
		expect(
			lint('await guards(await fetch("https://example.com")).requireUser(ctx);', 'action')
		).toEqual([{ messageId: 'effectBeforeGuard', line: 2 }]);
	});

	it('reports an optional synchronous guard before an effect', () => {
		expect(
			lint(
				'const guards = args.check ? { requireTestSecret } : undefined;\nguards?.requireTestSecret(args.secret);\nawait fetch("https://example.com");\nawait requireUser(ctx);',
				'action'
			)
		).toEqual([{ messageId: 'effectBeforeGuard', line: 4 }]);
	});

	it('passes an optional read in the guard arguments', () => {
		expect(
			lint('await requireOwner(ctx, args.note?.ownerId);\nawait ctx.db.delete("notes", args.id);')
		).toEqual([]);
	});

	it('reports an effect inside the arguments of the guard', () => {
		expect(lint('await requireAuth(await ctx.runMutation(internal.notes.touch, {}));')).toEqual([
			{ messageId: 'effectBeforeGuard', line: 2 }
		]);
	});
});
