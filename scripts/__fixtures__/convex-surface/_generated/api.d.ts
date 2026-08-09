import type { ApiFromModules, FilterApi, FunctionReference } from 'convex/server';

import type * as plain from '../plain.js';
import type * as area_nested from '../area/nested.js';

declare const fullApi: ApiFromModules<{
	plain: typeof plain;
	'area/nested': typeof area_nested;
}>;

export declare const api: FilterApi<typeof fullApi, FunctionReference<any, 'public'>>;
export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, 'internal'>>;
export declare const components: { some: { thing: FunctionReference<'query', 'public'> } };
