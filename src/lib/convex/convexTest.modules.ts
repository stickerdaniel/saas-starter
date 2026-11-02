/// <reference types="vite/client" />

/**
 * Module maps for `convexTest(schema, modules)` and `registerComponent`, imported before the
 * first test runs. The second dot in this file's name keeps Convex from deploying it.
 *
 * convex-test imports a function's module on its first call. With a lazy `import.meta.glob`
 * map, the test that calls first pays the cold transform of everything that module imports.
 * Vitest transforms on the main thread for all workers, so in a parallel run that one test
 * can pass the 5 s test timeout and keep running into the next test. A test file awaits these
 * imports at its top level instead, where Vitest collects the file without a timeout:
 *
 * ```ts
 * const agentModules = await preloadModules(import.meta.glob('<component dist>/*.js'));
 * const t = convexTest(schema, convexModules);
 * t.registerComponent('agent', agentSchema, agentModules);
 * ```
 *
 * Modules load before any hook runs. Stub an environment variable that a module reads at
 * load time in `vi.hoisted`, which runs before the test file's imports.
 */
export async function preloadModules(modules: Record<string, () => Promise<unknown>>) {
	// Importing a test file would register its tests in the caller.
	const entries = Object.entries(modules).filter(([path]) => !/\.test\.[jt]s$/u.test(path));
	const loaded = await Promise.allSettled(entries.map(([, load]) => load()));
	return Object.fromEntries(
		entries.map(([path], index) => {
			const result = loaded[index]!;
			// A module that cannot load, such as `convex.config.ts`, fails only the test that calls it.
			return [
				path,
				async () => {
					if (result.status === 'rejected') throw result.reason;
					return result.value;
				}
			];
		})
	);
}

/** Every app module, keyed `./path.ts` from the Convex root, where convex-test looks for `_generated`. */
export const convexModules = await preloadModules(
	import.meta.glob(['./**/*.ts', '!./convexTest.modules.ts'])
);
