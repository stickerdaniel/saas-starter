import { describe, expect, it } from 'vitest';
import { buildBugReportMailto } from '../mailto';

describe('buildBugReportMailto', () => {
	const base = {
		email: 'contact@example.com',
		subjectTemplate: 'Bug report: error {status}',
		bodyTemplate: 'I hit an error.\nURL: {url}\nStatus: {status}\n',
		url: 'https://example.com/en/broken?q=1',
		status: 500
	};

	it('addresses the configured email', () => {
		expect(buildBugReportMailto(base)).toMatch(/^mailto:contact@example\.com\?/);
	});

	it('substitutes {status} in the subject', () => {
		const href = buildBugReportMailto(base);
		const subject = new URLSearchParams(href.split('?')[1]).get('subject');
		expect(subject).toBe('Bug report: error 500');
	});

	it('substitutes {url} and {status} in the body', () => {
		const href = buildBugReportMailto(base);
		const body = new URLSearchParams(href.split('?')[1]).get('body');
		expect(body).toContain('URL: https://example.com/en/broken?q=1');
		expect(body).toContain('Status: 500');
	});

	it('encodes body line breaks as CRLF (%0D%0A), never bare LF', () => {
		const href = buildBugReportMailto(base);
		const encodedBody = href.split('&body=')[1]!;
		expect(encodedBody).toContain('%0D%0A');
		// every %0A must be part of a %0D%0A pair
		expect(encodedBody.replaceAll('%0D%0A', '')).not.toContain('%0A');
	});

	it('leaves existing CRLF line breaks intact (no doubled CR)', () => {
		const href = buildBugReportMailto({
			...base,
			bodyTemplate: 'Line one.\r\nURL: {url}\r\nStatus: {status}'
		});
		const encodedBody = href.split('&body=')[1]!;
		expect(encodedBody).not.toContain('%0D%0D');
		expect(encodedBody).toContain('%0D%0A');
	});

	it('percent-encodes reserved characters in subject and body', () => {
		const href = buildBugReportMailto({
			...base,
			subjectTemplate: 'Bug & error {status}',
			bodyTemplate: 'URL: {url}\nStatus: {status}'
		});
		const query = href.slice(href.indexOf('?') + 1);
		const params = new URLSearchParams(query);
		expect(params.get('subject')).toBe('Bug & error 500');
		expect(params.get('body')).toContain('https://example.com/en/broken?q=1');
	});
});
