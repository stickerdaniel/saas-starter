import spdxLicenses from 'spdx-license-list/full.js';

export interface GeneratedNoticeInput {
	licenseId: string;
	copyrights?: string[] | undefined;
	preamble?: string[] | undefined;
}

// SPDX texts whose copyright line is a template placeholder (or, for ISC, the
// license steward's own historical lines). A generated notice for these must
// supply its copyright lines, which replace the matched block. Copyright
// holders are never derived from package metadata such as `author`.
const COPYRIGHT_PLACEHOLDERS: Record<string, RegExp> = {
	MIT: /^Copyright \(c\) <year> <copyright holders>[ \t]*$/m,
	'BSD-2-Clause': /^Copyright \(c\) <year> <owner>[ \t]*$/m,
	'BSD-3-Clause': /^Copyright \(c\) <year> <owner>\.[ \t]*$/m,
	'0BSD': /^Copyright \(C\) YEAR by AUTHOR EMAIL[ \t]*$/m,
	ISC: /^Copyright \(c\) 2004-2010 by Internet Systems Consortium, Inc\. \("ISC"\)\nCopyright \(c\) 1995-2003 by Internet Software Consortium[ \t]*$/m
};

export function isKnownLicenseId(licenseId: string): boolean {
	return Object.hasOwn(spdxLicenses, licenseId);
}

export function requiresCopyrights(licenseId: string): boolean {
	return Object.hasOwn(COPYRIGHT_PLACEHOLDERS, licenseId);
}

/** Problems with a generated notice request, empty when it can be rendered. */
export function generatedNoticeProblems(notice: GeneratedNoticeInput): string[] {
	if (!isKnownLicenseId(notice.licenseId)) {
		return [
			`"${notice.licenseId}" is not a single license identifier in spdx-license-list. Use one SPDX id per generated notice.`
		];
	}
	if (requiresCopyrights(notice.licenseId) && !notice.copyrights?.length) {
		return [
			`${notice.licenseId} needs "copyrights": its license template has a copyright placeholder. Copy the holder lines from the upstream source; never use the package author.`
		];
	}
	return [];
}

export function renderGeneratedNotice(notice: GeneratedNoticeInput): string {
	const problems = generatedNoticeProblems(notice);
	if (problems.length) throw new Error(problems.join('\n'));

	const licenseText = normalizeNoticeText(spdxLicenses[notice.licenseId]!.licenseText);
	const copyrights = notice.copyrights ?? [];
	const placeholder = COPYRIGHT_PLACEHOLDERS[notice.licenseId];
	let body = licenseText;
	const parts: string[] = [];
	if (notice.preamble?.length) parts.push(notice.preamble.join('\n'));
	if (placeholder) {
		if (!placeholder.test(licenseText)) {
			throw new Error(
				`The ${notice.licenseId} text in spdx-license-list no longer contains the expected copyright placeholder. Update the template pattern before generating notices.`
			);
		}
		body = licenseText.replace(placeholder, () => copyrights.join('\n'));
	} else if (copyrights.length) {
		parts.push(copyrights.join('\n'));
	}
	parts.push(body);
	return parts.join('\n\n');
}

/** Normalize line endings, a byte-order mark, and surrounding blank space. */
export function normalizeNoticeText(text: string): string {
	return text
		.replace(/^\uFEFF/, '')
		.replace(/\r\n?/g, '\n')
		.replace(/[ \t]+$/gm, '')
		.replace(/^\n+|\s+$/g, '');
}
