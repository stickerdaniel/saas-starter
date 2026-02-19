import type { FieldDefinition } from '$lib/admin/types';
import { resolveFieldValue } from '$lib/admin/field-utils';

function escapeCsvCell(value: unknown) {
	let text = String(value ?? '');
	if (/^[=+\-@\t\r]/.test(text)) {
		text = `'${text}`;
	}
	if (/[",\n]/.test(text)) {
		return `"${text.replaceAll('"', '""')}"`;
	}
	return text;
}

function toExportValue(field: FieldDefinition<any>, row: Record<string, unknown>) {
	const resolved = resolveFieldValue(field, row);
	if (
		typeof resolved === 'string' ||
		typeof resolved === 'number' ||
		typeof resolved === 'boolean'
	) {
		return resolved;
	}
	if (resolved === null || resolved === undefined) {
		return '';
	}
	try {
		return JSON.stringify(resolved);
	} catch {
		return String(resolved);
	}
}

export function createCsvFromRows(args: {
	fields: FieldDefinition<any>[];
	rows: Record<string, unknown>[];
}) {
	const headers = args.fields.map((field) => field.attribute);
	const lines = [headers.map((header) => escapeCsvCell(header)).join(',')];
	for (const row of args.rows) {
		const cells = args.fields.map((field) => escapeCsvCell(toExportValue(field, row)));
		lines.push(cells.join(','));
	}
	return lines.join('\n');
}

export function createJsonFromRows(args: {
	fields: FieldDefinition<any>[];
	rows: Record<string, unknown>[];
}) {
	const items = args.rows.map((row) => {
		const next: Record<string, unknown> = {};
		for (const field of args.fields) {
			next[field.attribute] = resolveFieldValue(field, row);
		}
		return next;
	});
	return JSON.stringify(items, null, 2);
}

export function downloadTextFile(args: { filename: string; content: string; mimeType: string }) {
	const blob = new Blob([args.content], { type: `${args.mimeType};charset=utf-8` });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = args.filename;
	anchor.click();
	URL.revokeObjectURL(url);
}
