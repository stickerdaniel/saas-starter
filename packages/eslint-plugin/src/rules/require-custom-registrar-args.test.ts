import { Linter } from 'eslint';
import { parser } from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import rule from './require-custom-registrar-args.js';

const BUILDERS = ['authedQuery', 'authedMutation', 'adminQuery', 'adminMutation'];
const linter = new Linter({ configType: 'flat' });
const configWith = (severity: unknown) => [
	{
		files: ['**/*.ts'],
		languageOptions: { parser },
		plugins: { local: { rules: { 'require-custom-registrar-args': rule } } },
		rules: { 'local/require-custom-registrar-args': severity }
	}
];

const messageIds = (code: string) =>
	linter
		.verify(code, configWith(['error', { builders: BUILDERS }]), {
			filename: 'src/lib/convex/notes.ts'
		})
		.map((message) => message.messageId);

describe('require-custom-registrar-args', () => {
	it.each([
		['no options', 'error'],
		['an empty builders list', ['error', { builders: [] }]]
	])('rejects a config with %s', (_label, severity) => {
		expect(() =>
			linter.verify('export {};', configWith(severity), { filename: 'src/lib/convex/notes.ts' })
		).toThrow(
			/Key "local\/require-custom-registrar-args":\n\tValue \[\] should NOT have fewer than 1 items/
		);
	});

	it.each(BUILDERS)('reports %s without args', (builder) => {
		expect(
			messageIds(`export const f = ${builder}({ returns: v.null(), handler: async () => null });`)
		).toEqual(['missingArgs']);
	});

	it.each([
		['a config held in a variable', 'authedQuery(config)'],
		[
			'a spread without a written args key',
			'authedMutation({ ...{}, returns: v.null(), handler })'
		],
		['a computed key named like args', 'adminQuery({ [args]: {}, returns: v.null(), handler })']
	])('reports %s', (_label, call) => {
		expect(messageIds(`export const f = ${call};`)).toEqual(['missingArgs']);
	});

	it.each([
		['declared args', 'authedMutation({ args: { id: v.string() }, returns: v.null(), handler })'],
		['empty args', 'adminQuery({ args: {}, returns: v.null(), handler })'],
		['a quoted args key', "adminMutation({ 'args': {}, returns: v.null(), handler })"],
		['a config wrapped in satisfies', 'authedQuery({ args: {}, handler } satisfies Config)'],
		[
			'factory configuration that registers through an internal builder',
			'createFounderIncidentEmailMutation({ registry: founderIncidentRegistry, resolveContact })'
		],
		['a raw builder, which the upstream rule reads', 'query({ handler })'],
		['a builder outside the configured list', 'ownerQuery({ handler })']
	])('passes %s', (_label, call) => {
		expect(messageIds(`export const f = ${call};`)).toEqual([]);
	});
});
