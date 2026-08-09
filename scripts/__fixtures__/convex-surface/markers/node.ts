import { query } from '../_generated/server';

// All five names collide with FunctionReference's markers. Convex's FilterApi
// omits the whole `markers` branch, so direct api.markers.node.* syntax does
// not exist and there is no caller-visible promise for this guard to protect.
export const _type = query({ handler: async () => null });
export const _visibility = query({ handler: async () => null });
export const _args = query({ handler: async () => null });
export const _returnType = query({ handler: async () => null });
export const _componentPath = query({ handler: async () => null });
