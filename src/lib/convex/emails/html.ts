/**
 * Escape HTML special characters for safe rendering in an HTML text or
 * attribute context. Shared by the template renderers and the row builders
 * that produce HTML for a template placeholder.
 */
export function escapeHtml(str: string): string {
	return str.replace(
		/[&<>"']/g,
		(c) =>
			({
				'&': '&amp;',
				'<': '&lt;',
				'>': '&gt;',
				'"': '&quot;',
				"'": '&#39;'
			})[c]!
	);
}
