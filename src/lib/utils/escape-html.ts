/**
 * Escape HTML special characters to prevent XSS when interpolating
 * user-supplied values into raw HTML strings (e.g. createRawSnippet).
 */
export function escapeHtml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}
