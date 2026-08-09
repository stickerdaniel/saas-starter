import { query } from './_generated/server';
import { toolkit } from './toolkit';

export const keep = query({ handler: async () => null });
// TS2339, which TypeScript recovers as any. The surface refuses the effect
// when deployed code protects this identifier, without making an unrelated
// intentionally-any adapter fatal.
export const erased = toolkit.mutation({ handler: async () => null });

// Named re-exports have an ExportSpecifier declaration, not a valueDeclaration.
export { drifted as renamed } from './reexport-source';
