import { lex } from 'svelte-streamdown';
import { describe, expect, it } from 'vitest';
import { localizeRelativeMarkdownLinks } from './legal-markdown';

const localize = (path: string) => `/de${path}`;

function linkTargets(value: unknown): string[] {
	if (Array.isArray(value)) return value.flatMap(linkTargets);
	if (!value || typeof value !== 'object') return [];
	const record = value as Record<string, unknown>;
	const target = record.type === 'link' && typeof record.href === 'string' ? [record.href] : [];
	return [...target, ...Object.values(record).flatMap(linkTargets)];
}

describe('localizeRelativeMarkdownLinks', () => {
	it('localizes inline and reference-style relative destinations', () => {
		const markdown = [
			'[Inline](privacy "Policy")',
			'[Reference][policy]',
			'',
			'[policy]: <terms> "Terms"'
		].join('\n');

		const localized = localizeRelativeMarkdownLinks(markdown, localize);
		expect(localized).toBe(
			[
				'[Inline](/de/privacy "Policy")',
				'[Reference][policy]',
				'',
				'[policy]: </de/terms> "Terms"'
			].join('\n')
		);
		expect(linkTargets(lex(localized))).toEqual(['/de/privacy', '/de/terms']);
	});

	it('leaves absolute, root-relative, anchor, and protocol destinations unchanged', () => {
		const markdown = [
			'[Web](https://example.com)',
			'[Root](/privacy)',
			'[Anchor](#privacy)',
			'[Email][email]',
			'A statement.[^1]',
			'',
			'[email]: mailto:privacy@example.com',
			'[^1]: Supporting text.'
		].join('\n');

		expect(localizeRelativeMarkdownLinks(markdown, localize)).toBe(markdown);
	});
});
