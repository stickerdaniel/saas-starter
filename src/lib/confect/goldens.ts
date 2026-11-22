import { createHash } from 'node:crypto';
import { format } from 'prettier';

export type Json =
	null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

export const GOLDENS_DIR = 'src/lib/confect/__goldens__';

export function isJsonList(value: Json | undefined): value is readonly Json[] {
	return Array.isArray(value);
}

function canonical(value: Json): Json {
	if (isJsonList(value)) return value.map(canonical);
	if (typeof value !== 'object' || value === null) return value;
	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.map((key) => [key, canonical(value[key] ?? null)])
	);
}

export function digest(value: Json): string {
	return createHash('sha256')
		.update(JSON.stringify(canonical(value)))
		.digest('hex')
		.slice(0, 16);
}

export function goldenText(value: Json): Promise<string> {
	return format(JSON.stringify(canonical(value)), {
		parser: 'json',
		useTabs: true,
		printWidth: 100
	});
}
