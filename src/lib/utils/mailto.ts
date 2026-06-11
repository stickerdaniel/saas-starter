/**
 * Builds an RFC 6068 `mailto:` href for a pre-filled bug report.
 *
 * Substitutes `{status}` in the subject and `{url}` / `{status}` in the
 * body, then normalizes body line breaks to CRLF before percent-encoding.
 * Apple Mail and other RFC-6068-strict clients silently refuse to open a
 * mailto whose body uses bare LF (`%0A`); they require `%0D%0A`.
 */
export function buildBugReportMailto(options: {
	email: string;
	subjectTemplate: string;
	bodyTemplate: string;
	url: string;
	status: number;
}): string {
	const status = String(options.status);
	const subject = options.subjectTemplate.replace('{status}', status);
	const body = options.bodyTemplate
		.replace('{url}', options.url)
		.replace('{status}', status)
		.replace(/\r?\n/g, '\r\n');
	return `mailto:${options.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
