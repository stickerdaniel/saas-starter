// A module the generated api does not list. Convex decides that: a component
// directory, a schema, a multi-dot name, a .cjs module whose named exports it
// never emits, a file whose statements sit behind a comment. Whatever the
// reason, an unlisted module publishes nothing, and the surface follows.
import { mutation } from '../_generated/server';

export const unreachable = mutation({ handler: async () => null });
