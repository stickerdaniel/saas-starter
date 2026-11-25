import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Linter } from 'eslint';
import { parser } from 'typescript-eslint';
import { FunctionSpec } from '@confect/core';
import { afterAll, describe, expect, it } from 'vitest';
import { CONFECT_NATIVE_SPECS, CONFECT_PLAIN_SPECS } from '../convex-registrars.js';
import rule from './convex-canonical-registration.js';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'convex-canonical-registration-'));
fs.writeFileSync(
	path.join(directory, 'notes.spec.ts'),
	`import { FunctionSpec, GroupSpec } from '@confect/core';
import type { list } from './notes';
export default GroupSpec.make().addFunction(FunctionSpec.convexPublicQuery<typeof list>()('list'));
`
);
fs.writeFileSync(
	path.join(directory, 'native.spec.ts'),
	`import { FunctionSpec, GroupSpec } from '@confect/core';
import type { list } from './notes';
export default GroupSpec.make()
	.addFunction(FunctionSpec.convexPublicQuery<typeof list>()('list'))
	.addFunction(FunctionSpec.publicQuery({ name: 'page', args: () => ({}), returns: () => Schema.Null }));
`
);
fs.writeFileSync(
	path.join(directory, 'asserted.spec.ts'),
	`import { FunctionSpec, GroupSpec } from '@confect/core';
import type { list } from './legacy';
export const nativeGroup = GroupSpec.make().addFunction(
	FunctionSpec.internalQuery({ name: 'list', args: () => ({}), returns: () => Schema.Number } as const)
);
const legacy = GroupSpec.make().addFunction(FunctionSpec.convexInternalQuery<typeof list>()('list'));
export default GroupSpec.addGroupsAt(legacy, { nativeGroup });
`
);
fs.writeFileSync(
	path.join(directory, 'typed.spec.ts'),
	`import { FunctionSpec, GroupSpec } from '@confect/core';
import { type list } from './notes';
export default GroupSpec.make().addFunction(FunctionSpec.convexPublicQuery<typeof list>()('list'));
`
);
fs.writeFileSync(
	path.join(directory, 'barrel.spec.ts'),
	`import { FunctionSpec, GroupSpec } from '@confect/core';
import type { list } from './legacy';
import { nativeGroup } from './native-group';
export { nativeGroup } from './native-group';
const legacy = GroupSpec.make().addFunction(FunctionSpec.convexPublicQuery<typeof list>()('list'));
export default GroupSpec.addGroupsAt(legacy, { nativeGroup });
`
);

fs.writeFileSync(
	path.join(directory, 'mixed.spec.ts'),
	`import { FunctionSpec, GroupSpec } from '@confect/core';
import type { list } from './legacy';
export const nativeGroup = GroupSpec.make().addFunction(
	FunctionSpec.publicQuery({ name: 'list', args: () => ({}), returns: () => Schema.Number })
);
const legacy = GroupSpec.make().addFunction(FunctionSpec.convexPublicQuery<typeof list>()('list'));
export default GroupSpec.addGroupsAt(legacy, { nativeGroup });
`
);

const librarySpec = `import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import type { onCreate, onDelete } from './library';
export default GroupSpec.make()
	.addFunction(FunctionSpec.publicQuery({ name: 'page', args: () => ({}), returns: () => Schema.Null }))
	.addFunction(FunctionSpec.convexInternalMutation<typeof onCreate>()('onCreate'))
	.addFunction(FunctionSpec.convexInternalMutation<typeof onDelete>()('onDelete'));
`;
fs.writeFileSync(path.join(directory, 'library.spec.ts'), librarySpec);
fs.writeFileSync(
	path.join(directory, 'grouped.spec.ts'),
	`import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import type { onCreate } from './library';
export const sub = GroupSpec.make().addFunction(FunctionSpec.convexInternalMutation<typeof onCreate>()('onCreate'));
const root = GroupSpec.make().addFunction(FunctionSpec.publicQuery({ name: 'page', args: () => ({}), returns: () => Schema.Null }));
export default GroupSpec.addGroupsAt(root, { sub });
`
);
fs.writeFileSync(
	path.join(directory, 'leaky.spec.ts'),
	`import { pageArgs } from './args';\n${librarySpec}`
);
fs.mkdirSync(path.join(directory, 'nested'));
fs.writeFileSync(path.join(directory, 'nested', 'library.spec.ts'), librarySpec);

afterAll(() => {
	fs.rmSync(directory, { recursive: true, force: true });
});

const linter = new Linter({ configType: 'flat', cwd: directory });
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
		.verify(code, config, { filename: path.join(directory, 'notes.impl.ts') })
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
		],
		[
			'an aliased Confect constructor import',
			`import { FunctionSpec as Spec } from '@confect/core';
			export const f = Spec.convexPublicQuery<typeof list>()('list');`,
			'aliasedImport'
		],
		[
			'a namespace import of Confect',
			`import * as Confect from '@confect/server';
			export const f = Confect.FunctionImpl.make(databaseSchema, notes, 'list', list);`,
			'namespaceImport'
		],
		[
			'a plain spec whose name differs from its registration',
			`import { FunctionSpec } from '@confect/core';
			export const f = FunctionSpec.convexPublicQuery<typeof list>()('listAll');`,
			'plainSpecShape'
		],
		[
			'a plain spec without its registration type',
			`import { FunctionSpec } from '@confect/core';
			export const f = FunctionSpec.convexInternalMutation()('remove');`,
			'plainSpecShape'
		],
		[
			'a plain spec named by a variable',
			`import { FunctionSpec } from '@confect/core';
			const name = 'list';
			export const f = FunctionSpec.convexPublicQuery<typeof list>()(name);`,
			'plainSpecShape'
		],
		[
			'a native spec named by a variable',
			`import { FunctionSpec } from '@confect/core';
			export const f = FunctionSpec.publicQuery({ name: listName, args: Schema.Struct({}), returns: Schema.Null });`,
			'nativeSpecShape'
		],
		[
			'a native spec with a spread config',
			`import { FunctionSpec } from '@confect/core';
			export const f = FunctionSpec.internalAction({ ...shared, name: 'sync' });`,
			'nativeSpecShape'
		],
		[
			'a spec constructor held in another binding',
			`import { FunctionSpec } from '@confect/core';
			const make = FunctionSpec.convexPublicQuery;
			export const f = make<typeof list>()('list');`,
			'confectMember'
		],
		[
			'a spec constructor read by a computed key',
			`import { FunctionSpec } from '@confect/core';
			export const f = FunctionSpec[kind]<typeof list>()('list');`,
			'confectMember'
		],
		[
			'a Confect constructor passed away whole',
			`import { FunctionSpec } from '@confect/core';
			export const f = register(FunctionSpec);`,
			'indirectReference'
		],
		[
			'an implementation named by a variable',
			`import { FunctionImpl } from '@confect/server';
			export const f = FunctionImpl.make(databaseSchema, notes, name, list);`,
			'implShape'
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
		],
		[
			'a Confect group of plain specs',
			`import { FunctionSpec, GroupSpec } from '@confect/core';
			import type { list, remove } from './notes';
			export default GroupSpec.make()
				.addFunction(FunctionSpec.convexPublicQuery<typeof list>()('list'))
				.addFunction(FunctionSpec.convexInternalMutation<typeof remove>()('remove'));`
		],
		[
			'a Confect-native spec',
			`import { FunctionSpec } from '@confect/core';
			export const f = FunctionSpec.publicPaginatedQuery({ name: 'page', args: Schema.Struct({}), item: Schema.String });`
		],
		[
			'a Confect group implementation',
			`import { FunctionImpl, GroupImpl } from '@confect/server';
			import * as Layer from 'effect/Layer';
			import { list } from './notes';
			import notes from './notes.spec';
			export default GroupImpl.make(databaseSchema, notes).pipe(
				Layer.provide([FunctionImpl.make(databaseSchema, notes, 'list', list)]),
				GroupImpl.finalize
			);`
		],
		[
			'a Confect type reference',
			`import { FunctionSpec } from '@confect/core';
			type Any = FunctionSpec.AnyWithProps;
			export const isSpec = FunctionSpec.isFunctionSpec;`
		]
	])('passes %s', (_label, code) => {
		expect(messageIds(code)).toEqual([]);
	});

	it('knows every function constructor Confect exports', () => {
		expect([...CONFECT_NATIVE_SPECS, ...CONFECT_PLAIN_SPECS].sort()).toEqual(
			Object.keys(FunctionSpec)
				.filter((name) => name !== 'TypeId' && name !== 'isFunctionSpec')
				.sort()
		);
	});

	describe('a native implementation', () => {
		const implementation = (handler: string, extra = "import * as Effect from 'effect/Effect';") =>
			messageIds(`import { FunctionImpl } from '@confect/server';
			${extra}
			export const f = FunctionImpl.make(databaseSchema, notes, 'list', ${handler});`);

		it.each([
			['an Effect.gen', '() => Effect.gen(function* () { return yield* Effect.succeed(null); })'],
			[
				'an Effect.gen piped through references and functions',
				"({ text }) => Effect.gen(function* () { return text; }).pipe(Effect.orDie, Effect.catchTag('Missing', () => Effect.succeed(null)))"
			],
			[
				'an Effect.fn call',
				"(args) => Effect.fn('notes.list')(function* (input) { return input; })(args)"
			],
			[
				'a block that only returns the Effect',
				'(args) => { return Effect.gen(function* () { return args; }); }'
			],
			[
				'a named gen import',
				'() => gen(function* () { return null; })',
				"import { gen } from 'effect/Effect';"
			],
			[
				'an Effect.gen piped through an operator with a callback',
				'() => Effect.gen(function* () { return 1; }).pipe(Effect.map((value) => value + 1))'
			],
			[
				'an Effect.fn call with an operator pipeable',
				"(args) => Effect.fn('notes.list')(function* (input) { return input; }, Effect.withSpan('notes'))(args)"
			],
			[
				'a destructured parameter with plain keys',
				'({ text, page: { size } }) => Effect.gen(function* () { return [text, size]; })'
			],
			[
				'a pipe argument from a namespace import',
				'() => Effect.gen(function* () { return null; }).pipe(Effect.provide(Layers.Live))',
				"import * as Effect from 'effect/Effect';\nimport * as Layers from './layers';"
			]
		])('passes %s', (_label, handler, extra?: string) => {
			expect(implementation(handler, extra)).toEqual([]);
		});

		it.each([
			[
				'a factory with an observable step before the Effect',
				'(args) => { console.log("list", args); return Effect.gen(function* () { return args; }); }'
			],
			[
				'a factory that reads before the Effect',
				'(args) => { const row = load(args); return Effect.gen(function* () { return row; }); }'
			],
			['an Effect built from an eager value', '() => Effect.succeed(compute())'],
			['an async implementation', 'async () => Effect.gen(function* () { return null; })'],
			[
				'a default value computed before the Effect',
				'({ limit = expensive() }) => Effect.gen(function* () { return limit; })'
			],
			[
				'a pipe argument computed before the Effect',
				'() => Effect.gen(function* () { return null; }).pipe(Effect.provideService(Tag, build()))'
			],
			[
				'an Effect.fn called with a computed argument',
				'(args) => Effect.fn(function* (input) { return input; })(prepare(args))'
			],
			[
				'a pipe callback that runs before the Effect',
				'() => Effect.gen(function* () { return "ok"; }).pipe((effect) => { danger(); return effect; })'
			],
			[
				'a computed key in the parameter destructuring',
				'({ [eager()]: value }) => Effect.gen(function* () { return value; })'
			],
			[
				'a computed key in a nested parameter pattern',
				'({ page: { [eager()]: size } }) => Effect.gen(function* () { return size; })'
			],
			[
				'a pipe operator that runs the Effect',
				'() => Effect.gen(function* () { return null; }).pipe(Effect.runSync)'
			],
			[
				'a pipe operator from another module',
				'() => Effect.gen(function* () { return null; }).pipe(withAudit(log))'
			],
			[
				'an Effect.fn pipeable that is a plain function',
				"(args) => Effect.fn('notes.list')(function* (input) { return input; }, (effect) => { danger(); return effect; })(args)"
			],
			[
				'a pipe operator that runs the Effect eagerly',
				'() => Effect.gen(function* () { return null; }).pipe(Effect.fnUntracedEager(function* (program) { danger(); return yield* program; }))'
			],
			[
				'a pipe argument read through a property',
				'() => Effect.gen(function* () { return 1; }).pipe(Effect.map(operators.mapper))'
			],
			[
				'a pipe argument read below a namespace export',
				'() => Effect.gen(function* () { return 1; }).pipe(Effect.map(Operators.registry.mapper))',
				"import * as Effect from 'effect/Effect';\nimport * as Operators from './operators';"
			],
			[
				'an Effect.fn called with a property read',
				"(args) => Effect.fn('notes.list')(function* (input) { return input; })(args.input)"
			],
			[
				'gen from a module other than effect/Effect',
				'() => Effect.gen(function* () { return null; })',
				"import * as Effect from './effect';"
			]
		])('reports %s', (_label, handler, extra?: string) => {
			expect(implementation(handler, extra)).toEqual(['eagerImplementation']);
		});

		it.each([
			['a native spec', 'native', 'page'],
			['a plain spec next to a native one', 'native', 'list'],
			['a plain spec next to an asserted native one', 'asserted', 'list'],
			['a name the spec file does not declare', 'notes', 'other']
		])('reports an imported implementation of %s', (_label, spec, name) => {
			expect(
				messageIds(`import { FunctionImpl } from '@confect/server';
				import { list } from './factories';
				import notes from './${spec}.spec';
				export const f = FunctionImpl.make(databaseSchema, notes, '${name}', list);`)
			).toEqual(['inlineImplementation']);
		});

		it('reports an imported implementation for a group its spec file re-exports from another module', () => {
			expect(
				messageIds(`import { FunctionImpl } from '@confect/server';
				import { list } from './factories';
				import { nativeGroup } from './barrel.spec';
				export const f = FunctionImpl.make(databaseSchema, nativeGroup, 'list', list);`)
			).toEqual(['inlineImplementation']);
		});

		it('reports an imported implementation whose name has another kind in a second group of its spec file', () => {
			expect(
				messageIds(`import { FunctionImpl } from '@confect/server';
				import { list } from './factories';
				import { nativeGroup } from './mixed.spec';
				export const f = FunctionImpl.make(databaseSchema, nativeGroup, 'list', list);`)
			).toEqual(['inlineImplementation']);
		});

		it('reports an imported implementation whose spec file it cannot read', () => {
			expect(
				messageIds(`import { FunctionImpl } from '@confect/server';
				import { list } from './notes';
				import notes from './missing.spec';
				export const f = FunctionImpl.make(databaseSchema, notes, 'list', list);`)
			).toEqual(['inlineImplementation']);
		});

		it('passes an imported implementation from a spec file with a specifier-level type import', () => {
			expect(
				messageIds(`import { FunctionImpl } from '@confect/server';
				import { list } from './notes';
				import notes from './typed.spec';
				export const f = FunctionImpl.make(databaseSchema, notes, 'list', list);`)
			).toEqual([]);
		});

		it('reports an implementation held in a local binding', () => {
			expect(
				implementation(
					'list',
					"import * as Effect from 'effect/Effect';\nconst list = () => Effect.gen(function* () { return null; });"
				)
			).toEqual(['inlineImplementation']);
		});
	});
});

describe('convex-canonical-registration library functions', () => {
	function libraryMessageIds(
		code: string,
		libraryFunctions: string[],
		file = 'library.impl.ts',
		confectDirectory = '.'
	) {
		return linter
			.verify(
				code,
				[
					{
						...config[0],
						rules: {
							'local/convex-canonical-registration': [
								'error' as const,
								{ confectDirectory, libraryFunctions }
							]
						}
					}
				],
				{ filename: path.join(directory, file) }
			)
			.map((message) => message.messageId);
	}

	const imported = (
		name: string,
		spec = './library.spec'
	) => `import { FunctionImpl } from '@confect/server';
		import { ${name} } from './library';
		import library from '${spec}';
		export const f = FunctionImpl.make(databaseSchema, library, '${name}', ${name});`;

	it('passes a listed plain function in a group with a native spec', () => {
		expect(libraryMessageIds(imported('onCreate'), ['library:onCreate'])).toEqual([]);
	});

	it('passes a listed plain function of a nested group by its path', () => {
		expect(
			libraryMessageIds(
				imported('onCreate', './library.spec'),
				['nested/library:onCreate'],
				'nested/library.impl.ts'
			)
		).toEqual([]);
	});

	it.each([
		['an unlisted plain function in that group', 'onDelete', ['library:onCreate']],
		['a listed name of another group', 'onCreate', ['other:onCreate']],
		['a listed native function', 'page', ['library:page']]
	])('reports %s', (_label, name, listed) => {
		expect(libraryMessageIds(imported(name), listed)).toEqual(['inlineImplementation']);
	});

	it('reports a listed function whose spec file reads a value from another module', () => {
		expect(libraryMessageIds(imported('onCreate', './leaky.spec'), ['leaky:onCreate'])).toEqual([
			'inlineImplementation'
		]);
	});

	it('reports a listed function of a subgroup its spec file exports by name', () => {
		expect(
			libraryMessageIds(
				`import { FunctionImpl } from '@confect/server';
				import { onCreate } from './library';
				import { sub } from './grouped.spec';
				export const f = FunctionImpl.make(databaseSchema, sub, 'onCreate', onCreate);`,
				['grouped:onCreate']
			)
		).toEqual(['inlineImplementation']);
	});

	it('reports a listed function of a group outside the Confect directory', () => {
		expect(
			libraryMessageIds(
				imported('onCreate', '../library.spec'),
				['library:onCreate', '../library:onCreate'],
				'nested/library.impl.ts',
				'nested'
			)
		).toEqual(['inlineImplementation']);
	});
});
