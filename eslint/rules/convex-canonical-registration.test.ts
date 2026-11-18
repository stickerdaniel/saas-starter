import { Linter } from 'eslint';
import { parser } from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import rule from './convex-canonical-registration.js';

const linter = new Linter({ configType: 'flat' });
const config = [
	{
		files: ['**/*.ts'],
		languageOptions: { parser },
		plugins: { local: { rules: { 'convex-canonical-registration': rule } } },
		rules: { 'local/convex-canonical-registration': 'error' as const }
	}
];

function messageIds(code: string) {
	return linter
		.verify(code, config, { filename: 'src/lib/convex/notes.ts' })
		.map((message) => message.messageId);
}

const canonical = `
	import { query, internalMutation } from './_generated/server';
	export const get = query({ args: {}, returns: v.null(), handler: async (ctx) => { await requireUser(ctx); return null; } });
`;

describe('convex-canonical-registration', () => {
	it('passes a canonical registration', () => {
		expect(messageIds(canonical)).toEqual([]);
	});

	it.each([
		[
			'an aliased builder import',
			`import { query as q } from './_generated/server';
			export const f = q({ args: {}, returns: v.string(), handler: async () => 'private' });`,
			'aliasedImport'
		],
		[
			'a namespace import',
			`import * as server from '../_generated/server';
			export const f = server.query({ args: {}, returns: v.string(), handler: async () => 'private' });`,
			'namespaceImport'
		],
		[
			'a quoted handler key',
			`import { query } from './_generated/server';
			export const f = query({ args: {}, returns: v.string(), "handler": async () => 'private' });`,
			'configShape'
		],
		[
			'a handler that is not inline',
			`import { query } from './_generated/server';
			const someFunction = async () => 'private';
			export const f = query({ args: {}, returns: v.string(), handler: someFunction });`,
			'inlineHandler'
		],
		[
			'a builder held in another binding',
			`import { mutation } from './_generated/server';
			const register = mutation;
			export const f = register({ args: {}, returns: v.null(), handler: async () => null });`,
			'indirectReference'
		],
		[
			'a spread config',
			`import { query } from './_generated/server';
			export const f = query({ ...shared, returns: v.null() });`,
			'configShape'
		],
		[
			'a config held in a variable',
			`import { action } from './_generated/server';
			const config = { args: {}, returns: v.null(), handler: async () => null };
			export const f = action(config);`,
			'configShape'
		],
		[
			'an optional builder call',
			`import { query } from './_generated/server';
			export const f = query?.({ args: {}, returns: v.null(), handler: async () => null });`,
			'optionalCall'
		],
		[
			'a builder passed to a local lookalike factory',
			`import { query } from './_generated/server';
			function customRegister(builder: typeof query) { return builder; }
			const open = customRegister(query);
			export const f = open({ args: {}, returns: v.null(), handler: async () => null });`,
			'indirectReference'
		],
		[
			'an aliased custom builder import',
			`import { authedQuery as checked } from './functions';
			export const f = checked({ returns: v.null(), handler: async () => null });`,
			'aliasedImport'
		],
		[
			'a custom builder held in another binding',
			`import { adminMutation } from '../functions';
			const register = adminMutation;
			export const f = register({ returns: v.null(), handler: async () => null });`,
			'indirectReference'
		],
		[
			'a namespace import of the custom builders',
			`import * as builders from '../functions';
			export const f = builders.authedQuery({ returns: v.null(), handler: async () => null });`,
			'namespaceImport'
		],
		[
			'a re-exported builder',
			`export { query as publicQuery } from './_generated/server';`,
			'reexport'
		]
	])('reports %s', (_label, code, messageId) => {
		expect(messageIds(code)).toContain(messageId);
	});

	it.each([
		[
			'an internal registration with a named handler',
			`import { internalMutation } from './_generated/server';
			const run = async () => null;
			export const f = internalMutation({ args: {}, returns: v.null(), handler: run });`
		],
		[
			'a builder passed to a convex-helpers custom builder',
			`import { customQuery, customCtx } from 'convex-helpers/server/customFunctions';
			import { query } from './_generated/server';
			export const authedQuery = customQuery(query, customCtx(async (ctx) => ({ user: await getUser(ctx) })));`
		],
		[
			'a custom builder called under its own name',
			`import { authedQuery } from '../functions';
			export const f = authedQuery({ args: {}, returns: v.null(), handler: async () => null });`
		],
		[
			'a type-only reference to a builder',
			`import { query } from './_generated/server';
			type Builder = typeof query;`
		],
		[
			'a method handler',
			`import { query } from './_generated/server';
			export const f = query({ args: {}, returns: v.null(), async handler(ctx) { await requireUser(ctx); return null; } });`
		],
		[
			'a builder of the same name from another module',
			`import { query as q } from 'some-library';
			export const f = q({ handler: someFunction });`
		]
	])('passes %s', (_label, code) => {
		expect(messageIds(code)).toEqual([]);
	});
});
