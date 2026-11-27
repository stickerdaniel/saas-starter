// @vitest-environment node
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Record from 'effect/Record';
import { describe, expect, it } from 'vitest';
import { STATIC_TRANSLATIONS } from '../../i18n/static-translations.generated';
import { CAPABILITIES, capabilityKey } from '../../mcp/capabilities';
import { McpAccess, McpPrincipal, scopeAccess } from './access';
import { AppToolkit } from './toolkit';

const sentence = (locale: unknown, key: string) =>
	key
		.split('.')
		.reduce<unknown>(
			(node, segment) =>
				typeof node === 'object' && node !== null && segment in node
					? Object.fromEntries(Object.entries(node))[segment]
					: undefined,
			locale
		);

const levelOf = Effect.gen(function* () {
	const access = yield* McpAccess;
	return (tool: Parameters<typeof access.decide>[0]) =>
		access.decide(tool)._tag === 'Allowed' ? 'view' : 'change';
}).pipe(
	Effect.provide(
		scopeAccess.pipe(
			Layer.provide(
				Layer.succeed(McpPrincipal, { userId: 'u', clientId: 'c', scopes: ['mcp:read'] })
			)
		)
	),
	Effect.runSync
);

describe('MCP capability list', () => {
	const tools = Record.toEntries(AppToolkit.tools);

	it.each(tools)('lists %s once, at the level scopeAccess derives', (name, tool) => {
		const entries = CAPABILITIES.filter((capability) => capability.tool === name);
		expect(entries).toHaveLength(1);
		expect(entries[0]?.level).toBe(levelOf(tool));
	});

	it('names no tool the toolkit lacks', () => {
		const names = new Set(tools.map(([name]) => name));
		expect(CAPABILITIES.filter((capability) => !names.has(capability.tool))).toEqual([]);
	});

	it.each(Record.toEntries(STATIC_TRANSLATIONS))(
		'has a sentence for every capability in %s',
		(_code, locale) => {
			for (const capability of CAPABILITIES) {
				expect(sentence(locale, capabilityKey(capability))).toEqual(expect.stringMatching(/\S/u));
			}
		}
	);
});
