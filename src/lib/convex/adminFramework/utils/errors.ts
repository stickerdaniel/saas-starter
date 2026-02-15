export type ActionResponse =
	| { type: 'message'; text: string }
	| { type: 'danger'; text: string }
	| { type: 'download'; url: string; filename: string }
	| { type: 'redirect'; url: string }
	| { type: 'modal'; title: string; description: string }
	| { type: 'event'; name: string; payload?: Record<string, unknown> };

export function notFoundError(resource: string): never {
	throw new Error(`${resource} not found`);
}

export function assert(condition: unknown, message: string): asserts condition {
	if (!condition) {
		throw new Error(message);
	}
}

export function success(text: string): ActionResponse {
	return { type: 'message', text };
}
