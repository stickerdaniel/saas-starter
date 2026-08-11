import { query } from '../../_generated/server';

// Marker names are legal module segments. api.foo.bar is already a function,
// and its `_type` marker is intersected with this namespace.
export const deep = query({ handler: async () => null });
