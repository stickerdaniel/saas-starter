export function appendVary(headers: Headers, value: string): void {
	const entries = (headers.get('Vary') ?? '')
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean);
	if (!entries.some((entry) => entry.toLowerCase() === value.toLowerCase())) {
		entries.push(value);
	}
	headers.set('Vary', entries.join(', '));
}
