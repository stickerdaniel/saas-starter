// @vitest-environment node
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { convexModules, preloadModules } from './convexTest.modules';

const REGISTRATIONS = './_generated/registeredFunctions/';
const NATIVE = '../convex/';
const COMPONENT_CONFIG = 'convex.config.ts';

const registrations = await preloadModules(
	import.meta.glob('./_generated/registeredFunctions/**/*.ts')
);

type Exports = Readonly<Record<string, unknown>>;

function exportsOf(value: unknown): Exports {
	if (typeof value !== 'object' || value === null) throw new Error('expected a module namespace');
	return Object.fromEntries(Object.entries(value));
}

function isRegisteredFunction(value: unknown): boolean {
	return (
		typeof value === 'function' &&
		('isQuery' in value || 'isMutation' in value || 'isAction' in value)
	);
}

async function load(modules: typeof convexModules, key: string): Promise<Exports> {
	const loader = modules[key];
	if (!loader) throw new Error(`${key} is missing`);
	return exportsOf(await loader());
}

describe('Confect groups', () => {
	it('exist', () => {
		expect(Object.keys(registrations)).not.toEqual([]);
	});

	it('cover every native module that publishes an RPC function', async () => {
		const ungrouped: string[] = [];
		for (const key of Object.keys(convexModules)) {
			const group = key.slice(NATIVE.length);
			if (group.startsWith('_generated/') || group === COMPONENT_CONFIG) continue;
			if (`${REGISTRATIONS}${group}` in registrations) continue;
			const native = await load(convexModules, key);
			if (Object.values(native).some(isRegisteredFunction)) ungrouped.push(group);
		}
		expect(ungrouped).toEqual([]);
	});

	it.each(Object.keys(registrations).map((key) => key.slice(REGISTRATIONS.length)))(
		'%s registers exactly the functions its native module publishes',
		async (group) => {
			const registered = exportsOf((await load(registrations, `${REGISTRATIONS}${group}`)).default);
			const native = await load(convexModules, `${NATIVE}${group}`);
			const published = Object.keys(native)
				.filter((name) => isRegisteredFunction(native[name]))
				.sort();

			expect(Object.keys(registered).sort()).toEqual(published);
			expect(published.filter((name) => registered[name] !== native[name])).toEqual([]);
		}
	);
});
