// A plain nested directory without a convex.config.ts stays root api, and its
// identifier joins with a forward slash on every platform.
import type { RegisteredQuery } from 'convex/server';

declare const value: RegisteredQuery<'public', Record<string, never>, Promise<null>>;
export const fromNested = value;
