import type { FieldDefinition } from './types';

/** Extract raw attribute value, then run resolveUsing if defined. */
export function resolveFieldValue(
	field: FieldDefinition,
	record: Record<string, unknown>
): unknown {
	const raw = record[field.attribute];
	return field.resolveUsing ? field.resolveUsing(raw, record, field.attribute) : raw;
}

/** Run displayUsing on an already-resolved value, returning undefined if no callback. */
export function displayFieldValue(
	field: FieldDefinition,
	value: unknown,
	record: Record<string, unknown>
): string | undefined {
	return field.displayUsing ? field.displayUsing(value, record, field.attribute) : undefined;
}
