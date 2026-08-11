import type { ApiFromModules, FilterApi, FunctionReference } from 'convex/server';
import type * as broken from '../broken.js';
declare const fullApi: ApiFromModules<{ broken: typeof broken }>;
export declare const api: FilterApi<typeof fullApi, FunctionReference<any, 'public'>>;
export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, 'internal'>>;
