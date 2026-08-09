/**
 * Type-only shapes for the surface classifier test. Every export here is a way
 * a Convex module can (or can appear to) publish a function; the test pins
 * which of them the classifier counts.
 */

import type { RegisteredAction, RegisteredMutation, RegisteredQuery } from 'convex/server';

type NoArgs = Record<string, never>;

declare const publicMutation: RegisteredMutation<'public', NoArgs, Promise<null>>;
declare const internalMutation: RegisteredMutation<'internal', NoArgs, Promise<null>>;
declare const publicQuery: RegisteredQuery<'public', NoArgs, Promise<null>>;
declare const publicAction: RegisteredAction<'public', NoArgs, Promise<null>>;

export const direct = publicMutation;
export const directInternal = internalMutation;
export const directQuery = publicQuery;
export const directAction = publicAction;

// An alias to another export: still the same published function.
export const aliased = direct;

// Annotated with a named type alias: prints as the alias name, but the
// structure is still a registered public mutation and must count.
type NamedMutation = RegisteredMutation<'public', NoArgs, Promise<null>>;
declare const namedValue: NamedMutation;
export const named = namedValue;

// A registered function or a plain object: Convex cannot call this by name.
declare const unionValue: RegisteredMutation<'public', NoArgs, Promise<null>> | { disabled: true };
export const mixedUnion = unionValue;

// Containers and producers merely mention a registered function; none of them
// is one, and none may count.
export const wrappedObject = { handler: publicMutation };
export const inTuple = [publicMutation] as const;
export const producer = (): RegisteredMutation<'public', NoArgs, Promise<null>> => direct;

export const plainValue = 42;

// Marker properties present but not literally true: Convex's generated-API
// filter (`extends true`) rejects this, so the classifier must too.
export const falseMarkers = {
	isConvexFunction: false,
	isMutation: false,
	isPublic: false
} as const;

// A conditionally disabled export. Under the Convex project's strictness the
// generated api omits it, so it must not read as still published.
declare const maybeDisabled: RegisteredMutation<'public', NoArgs, Promise<null>> | undefined;
export const conditional = maybeDisabled;
