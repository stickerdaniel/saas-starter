import type { GenericCtx } from '@convex-dev/better-auth';
import type { DataModel } from '../_generated/dataModel';

/**
 * Better Auth's schema CLI needs the configured adapter but has no Convex
 * invocation. @convex-dev/better-auth requires GenericCtx even for schema-only
 * inspection. Its factory probes capabilities with `in` and defers operations.
 * Isolate that generated-tool boundary here: no capabilities are advertised,
 * and any attempted runtime access fails rather than using a pretend context.
 */
export function createSchemaGenerationContext(): GenericCtx<DataModel> {
	return new Proxy(
		{},
		{
			get(_target, property) {
				throw new Error(`Schema generation has no Convex runtime context: ${String(property)}`);
			}
		}
	) as GenericCtx<DataModel>;
}
