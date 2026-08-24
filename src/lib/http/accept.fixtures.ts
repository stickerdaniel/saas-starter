export const MARKDOWN_ACCEPT_FIXTURES = [
	{ value: null, expected: false },
	{ value: '', expected: false },
	{ value: 'text/html', expected: false },
	{ value: 'text/markdown', expected: true },
	{ value: 'TEXT/MARKDOWN; charset=utf-8', expected: true },
	{ value: 'text/html, text/markdown;q=0.5', expected: true },
	{ value: 'text/markdown;q=0', expected: false },
	{ value: 'text/markdown;q=0.000', expected: false },
	{ value: 'text/markdown;q=1.001', expected: false },
	{ value: 'text/markdown;q=wat', expected: false },
	{ value: 'application/json; note="text/markdown"', expected: false },
	{ value: 'application/json; note="a,b", text/markdown;q=0.8', expected: true }
] as const;
