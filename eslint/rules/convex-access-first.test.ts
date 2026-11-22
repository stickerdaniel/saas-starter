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

const groupConfig = [
	{
		...config[0],
		rules: {
			'local/convex-access-first': [
				'error' as const,
				{
					pattern: '^(require|assert|ensure)([A-Z_]|$)|^publicEndpoint$',
					middleware: ['RequireUser', 'RequireAdmin', 'VisitorAccess'],
					public: { 'tests:reset': 'Guarded by the E2E test secret.' }
				}
			]
		}
	}
];

const imports = `import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import RequireUser from './middleware/RequireUser.spec';
import RequireAdmin from '../middleware/RequireAdmin.spec';
import Logged from './middleware/Logged.spec';
import Lookalike from './RequireUser.spec';
`;

const publicQuery = "FunctionSpec.publicQuery({ name: 'list', returns: () => Schema.Null })";

function lintGroup(body: string, filename = 'src/lib/confect/notes.spec.ts') {
	return linter
		.verify(`${imports}${body}`, groupConfig, { filename })
		.map(({ messageId }) => messageId);
}

describe('convex-access-first in Confect groups', () => {
	it.each([
		[
			'group middleware before the function',
			`export default GroupSpec.make().middleware(RequireUser).addFunction(${publicQuery});`
		],
		[
			'group middleware after the function',
			`export default GroupSpec.make().addFunction(${publicQuery}).middleware(RequireAdmin);`
		],
		[
			'function middleware',
			`export default GroupSpec.make().addFunction(${publicQuery}.middleware(RequireUser));`
		],
		[
			'access middleware beside an observing one',
			`export default GroupSpec.make().middleware(Logged).addFunction(${publicQuery}.middleware(RequireUser));`
		],
		[
			'an internal native function',
			"export default GroupSpec.make().addFunction(FunctionSpec.internalMutation({ name: 'sweep', returns: () => Schema.Null }));"
		],
		[
			'a plain-provenance function, which keeps its own guard',
			"export default GroupSpec.make().addFunction(FunctionSpec.convexPublicQuery<typeof list>()('list'));"
		]
	])('passes %s', (_label, body) => {
		expect(lintGroup(body)).toEqual([]);
	});

	it('passes a function on the public allowlist', () => {
		expect(
			lintGroup(
				"export default GroupSpec.make().addFunction(FunctionSpec.publicMutation({ name: 'reset', returns: () => Schema.Null }));",
				'src/lib/confect/tests.spec.ts'
			)
		).toEqual([]);
	});

	it.each([
		['no middleware', `export default GroupSpec.make().addFunction(${publicQuery});`],
		[
			'only an observing middleware',
			`export default GroupSpec.make().middleware(Logged).addFunction(${publicQuery});`
		],
		[
			'a lookalike outside the middleware directory',
			`export default GroupSpec.make().middleware(Lookalike).addFunction(${publicQuery});`
		],
		[
			'middleware on another group in the file',
			`const other = GroupSpec.make().middleware(RequireUser);\nexport default GroupSpec.make().addFunction(${publicQuery});`
		],
		[
			'a public action without middleware',
			"export default GroupSpec.make().addFunction(FunctionSpec.publicAction({ name: 'sync', returns: () => Schema.Null }));"
		]
	])('reports a public native function with %s', (_label, body) => {
		expect(lintGroup(body)).toEqual(['missingMiddleware']);
	});

	it('checks a subgroup on its own', () => {
		expect(
			lintGroup(
				`export default GroupSpec.make().addFunction(${publicQuery});`,
				'src/lib/confect/notes/archive.spec.ts'
			)
		).toEqual(['missingMiddleware']);
	});

	it('names the function the allowlist would need', () => {
		const [message] = linter.verify(
			`${imports}export default GroupSpec.make().addFunction(${publicQuery});`,
			groupConfig,
			{ filename: 'src/lib/confect/notes/archive.spec.ts' }
		);
		expect(message?.message).toContain('`notes/archive:list`');
	});

	it.each([
		[
			'a spec outside the chain',
			`const list = ${publicQuery};\nexport default GroupSpec.make().middleware(RequireUser).addFunction(list);`
		],
		[
			'a group built from a binding',
			`const base = GroupSpec.make().middleware(RequireUser);\nexport default base.addFunction(${publicQuery});`
		]
	])('reports %s as unreadable', (_label, body) => {
		expect(lintGroup(body)).toEqual(['unreadGroup']);
	});
});
