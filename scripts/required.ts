export function required<T>(value: T | undefined, name: string): T {
	if (value === undefined) throw new Error(`Missing ${name}`);
	return value;
}
