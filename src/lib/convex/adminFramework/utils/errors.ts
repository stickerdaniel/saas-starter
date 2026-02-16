import { ConvexError } from 'convex/values';

export type ActionResponse =
	| { type: 'message'; text: string }
	| { type: 'danger'; text: string }
	| { type: 'download'; url: string; filename: string }
	| { type: 'redirect'; url: string }
	| { type: 'modal'; title: string; description: string }
	| { type: 'event'; name: string; payload?: Record<string, unknown> };

export type ValidationErrorData = {
	code: 'VALIDATION_ERROR';
	fieldErrors: Record<string, string>;
};

export function notFoundError(resource: string): never {
	throw new Error(`${resource} not found`);
}

export function validationError(fieldErrors: Record<string, string>): never {
	throw new ConvexError<ValidationErrorData>({
		code: 'VALIDATION_ERROR',
		fieldErrors
	});
}

export function assert(condition: unknown, message: string): asserts condition {
	if (!condition) {
		throw new Error(message);
	}
}

export function success(text: string): ActionResponse {
	return { type: 'message', text };
}
