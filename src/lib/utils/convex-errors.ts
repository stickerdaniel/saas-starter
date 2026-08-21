type StructuredErrorData = Record<string, unknown>;

function isStructuredErrorData(value: unknown): value is StructuredErrorData {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Read structured safe data from a ConvexError-like value.
 *
 * Convex transports the `data` payload across client and server boundaries;
 * callers should branch on that payload rather than the generated message.
 */
export function getConvexErrorData(error: unknown): StructuredErrorData | undefined {
	if (error === null || typeof error !== 'object' || !('data' in error)) {
		return undefined;
	}

	const data = (error as { data?: unknown }).data;
	return isStructuredErrorData(data) ? data : undefined;
}

export function getConvexErrorCode(error: unknown): string | undefined {
	const code = getConvexErrorData(error)?.code;
	return typeof code === 'string' ? code : undefined;
}
