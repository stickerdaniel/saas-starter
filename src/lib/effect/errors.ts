import * as Data from 'effect/Data';

export class Unauthenticated extends Data.TaggedError('Unauthenticated') {}

export class Forbidden extends Data.TaggedError('Forbidden')<{ readonly code: string }> {}

export class NotFound extends Data.TaggedError('NotFound')<{ readonly code: string }> {}

export class Invalid extends Data.TaggedError('Invalid')<{ readonly code: string }> {}

export class RateLimited extends Data.TaggedError('RateLimited')<{ readonly retryAfter: number }> {}

export class Upstream extends Data.TaggedError('Upstream')<{
	readonly service: string;
	readonly cause: unknown;
}> {}

export class TransportLost extends Data.TaggedError('TransportLost')<{ readonly cause: unknown }> {}

export const isRetryable = (error: unknown): error is TransportLost | RateLimited =>
	error instanceof TransportLost || error instanceof RateLimited;
