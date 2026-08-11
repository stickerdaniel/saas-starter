import { query } from './_generated/server';
import { adapter } from './adapter-source';
import { toolkit } from './toolkit';

export const keep = query({ handler: async () => null });
// The dependency has precise registration types, but its public type leaks
// non-portable internals. The compatibility reader recovers this assertion.
export const { adapted } = adapter.api() as any;
// TS2339, which TypeScript recovers as any. The surface refuses the effect
// when deployed code protects this identifier, without making an unrelated
// intentionally-any adapter fatal.
export const erased = toolkit.mutation({ handler: async () => null });

// Named re-exports have an ExportSpecifier declaration, not a valueDeclaration.
export { drifted as renamed } from './reexport-source';
