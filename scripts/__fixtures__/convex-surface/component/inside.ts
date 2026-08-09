// Published into the component's own namespace, never into the root api; the
// surface must not count it.
import type { RegisteredMutation } from 'convex/server';

declare const value: RegisteredMutation<'public', Record<string, never>, Promise<null>>;
export const hidden = value;
