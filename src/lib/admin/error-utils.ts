export function getValidationFieldErrors(error: unknown): Record<string, string> | null {
	if (!error || typeof error !== 'object') return null;

	const record = error as Record<string, unknown>;
	const data =
		typeof record.data === 'object' && record.data
			? (record.data as Record<string, unknown>)
			: typeof record.cause === 'object' && record.cause
				? ((record.cause as Record<string, unknown>).data as Record<string, unknown> | undefined)
				: undefined;

	if (!data || data.code !== 'VALIDATION_ERROR') return null;
	if (typeof data.fieldErrors !== 'object' || !data.fieldErrors) return null;

	const fieldErrors = data.fieldErrors as Record<string, unknown>;
	return Object.fromEntries(
		Object.entries(fieldErrors)
			.filter(([, value]) => typeof value === 'string')
			.map(([key, value]) => [key, String(value)])
	);
}
