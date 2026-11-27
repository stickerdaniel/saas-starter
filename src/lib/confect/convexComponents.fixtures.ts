/// <reference types="vite/client" />
import type { TestConvex } from 'convex-test';
import type { GenericSchema, SchemaDefinition } from 'convex/server';
import { preloadModules } from './convexTest.modules';

type ComponentSchema = SchemaDefinition<GenericSchema, boolean>;

interface InstalledComponent<S extends ComponentSchema> {
	readonly schema: S;
	readonly modules: Record<string, () => Promise<unknown>>;
}

function preloader<S extends ComponentSchema>(
	name: string,
	load: () => Promise<InstalledComponent<S>>
) {
	return async () => {
		const { schema, modules } = await load();
		const preloaded = await preloadModules(modules);
		return {
			schema,
			modules: preloaded,
			register: <Schema extends ComponentSchema>(t: TestConvex<Schema>) =>
				t.registerComponent(name, schema, preloaded)
		};
	};
}

export const preloadComponent = {
	agent: preloader('agent', async () => (await import('@convex-dev/agent/test')).default),
	rateLimiter: preloader(
		'rateLimiter',
		async () => (await import('@convex-dev/rate-limiter/test')).default
	),
	resend: preloader('resend', async () => (await import('@convex-dev/resend/test')).default),
	convexFilesControl: preloader(
		'convexFilesControl',
		async () => (await import('@gilhrpenner/convex-files-control/test')).default
	),
	betterAuth: preloader('betterAuth', async () => ({
		schema: (await import('../convex-components/betterAuth/schema')).default,
		modules: import.meta.glob('../convex-components/betterAuth/**/*.ts')
	}))
};
