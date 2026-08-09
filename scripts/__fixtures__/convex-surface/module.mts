// Convex bundles every entry-point extension it supports, so a function in an
// .mts module is published like any other and must appear in the surface.
import type { RegisteredMutation } from 'convex/server';

declare const value: RegisteredMutation<'public', Record<string, never>, Promise<null>>;
export const fromMts = value;
