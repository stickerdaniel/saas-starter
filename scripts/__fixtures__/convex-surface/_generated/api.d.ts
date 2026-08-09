import type { ApiFromModules, FilterApi, FunctionReference } from 'convex/server';

import type * as plain from '../plain.js';
import type * as area_nested from '../area/nested.js';
import type * as foo from '../foo.js';
import type * as foo_bar from '../foo/bar.js';
import type * as foo_bar_type from '../foo/bar/_type.js';
import type * as deep from '../a/b/c/d/e/f/g/h/i/j/k/l/m/deep.js';

declare const fullApi: ApiFromModules<{
	plain: typeof plain;
	'area/nested': typeof area_nested;
	foo: typeof foo;
	'foo/bar': typeof foo_bar;
	'foo/bar/_type': typeof foo_bar_type;
	'a/b/c/d/e/f/g/h/i/j/k/l/m/deep': typeof deep;
}>;

export declare const api: FilterApi<typeof fullApi, FunctionReference<any, 'public'>>;
export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, 'internal'>>;
export declare const components: { some: { thing: FunctionReference<'query', 'public'> } };
