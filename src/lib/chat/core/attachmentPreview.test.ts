import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	getExtension,
	getPreviewKind,
	isTextPreviewable,
	longestBacktickRun,
	buildCodeMarkdown,
	capPreviewText,
	MAX_PREVIEW_TEXT_CHARS
} from './attachmentPreview.js';
import { ALLOWED_FILE_EXT_MIME, ALLOWED_FILE_TYPES } from './types.js';
import { isAllowedStorageUrl } from '../../convex/files/attachmentText.js';

describe('getExtension', () => {
	it('returns the lowercased extension with dot', () => {
		expect(getExtension('README.md')).toBe('.md');
		expect(getExtension('photo.JPG')).toBe('.jpg');
		expect(getExtension('archive.tar.gz')).toBe('.gz');
	});
	it('returns null when there is no extension or filename', () => {
		expect(getExtension('noext')).toBeNull();
		expect(getExtension(undefined)).toBeNull();
	});
});

describe('getPreviewKind', () => {
	it('detects markdown by extension or mime', () => {
		expect(getPreviewKind('text/markdown', 'a.md')).toEqual({ kind: 'markdown' });
		expect(getPreviewKind(undefined, 'a.markdown')).toEqual({ kind: 'markdown' });
		expect(getPreviewKind('text/markdown', undefined)).toEqual({ kind: 'markdown' });
		// charset suffix must not break mime detection
		expect(getPreviewKind('text/markdown; charset=utf-8', undefined)).toEqual({ kind: 'markdown' });
	});
	it('maps known code extensions to highlighted code', () => {
		expect(getPreviewKind(undefined, 'data.json')).toEqual({ kind: 'code', lang: 'json' });
		expect(getPreviewKind(undefined, 'main.ts')).toEqual({ kind: 'code', lang: 'typescript' });
		expect(getPreviewKind('application/json', undefined)).toEqual({ kind: 'code', lang: 'json' });
	});
	it('treats csv and txt and unknown as plain text', () => {
		expect(getPreviewKind(undefined, 'rows.csv')).toEqual({ kind: 'plaintext' });
		expect(getPreviewKind('text/plain', 'notes.txt')).toEqual({ kind: 'plaintext' });
		expect(getPreviewKind('text/plain', 'weird.unknownext')).toEqual({ kind: 'plaintext' });
		expect(getPreviewKind(undefined, undefined)).toEqual({ kind: 'plaintext' });
	});
});

describe('isTextPreviewable', () => {
	it('is true for text-like content', () => {
		expect(isTextPreviewable('text/markdown', 'a.md')).toBe(true);
		expect(isTextPreviewable('text/plain; charset=utf-8', undefined)).toBe(true);
		expect(isTextPreviewable(undefined, 'notes.txt')).toBe(true);
		expect(isTextPreviewable(undefined, 'data.json')).toBe(true);
		expect(isTextPreviewable('application/json', undefined)).toBe(true);
	});
	it('is false for pdf, images and unknown binaries', () => {
		expect(isTextPreviewable('application/pdf', 'doc.pdf')).toBe(false);
		expect(isTextPreviewable('image/png', 'a.png')).toBe(false);
		expect(isTextPreviewable(undefined, 'photo.png')).toBe(false);
		expect(isTextPreviewable(undefined, undefined)).toBe(false);
	});
});

describe('longestBacktickRun', () => {
	it('counts the longest run', () => {
		expect(longestBacktickRun('no ticks here')).toBe(0);
		expect(longestBacktickRun('inline `code` span')).toBe(1);
		expect(longestBacktickRun('a ``` b')).toBe(3);
		expect(longestBacktickRun('```` and ``')).toBe(4);
	});
});

describe('buildCodeMarkdown', () => {
	it('uses a 3-backtick fence when content has none', () => {
		const out = buildCodeMarkdown('console.log(1)', 'javascript');
		expect(out).toBe('```javascript\nconsole.log(1)\n```');
	});
	it('uses a longer fence than any backtick run in the content', () => {
		const out = buildCodeMarkdown('a ``` b', 'json');
		expect(out.startsWith('````json\n')).toBe(true);
		expect(out.endsWith('\n````')).toBe(true);
		// the inner triple-backtick can no longer break out of the 4-fence
		expect(out).toContain('a ``` b');
	});
	it('handles content that ends with backticks and no trailing newline', () => {
		const out = buildCodeMarkdown('text```', 'text');
		expect(out).toBe('````text\ntext```\n````');
	});
});

describe('capPreviewText', () => {
	it('passes short text through untouched', () => {
		expect(capPreviewText('hello')).toEqual({ text: 'hello', truncated: false });
	});
	it('truncates text over the cap', () => {
		const big = 'x'.repeat(MAX_PREVIEW_TEXT_CHARS + 10);
		const res = capPreviewText(big);
		expect(res.truncated).toBe(true);
		expect(res.text.length).toBe(MAX_PREVIEW_TEXT_CHARS);
	});
});

describe('isAllowedStorageUrl (SSRF guard)', () => {
	const cloud = 'https://jovial-sturgeon-545.convex.cloud';
	it('accepts this deployment storage URLs', () => {
		expect(isAllowedStorageUrl(`${cloud}/api/storage/abc-123`, cloud)).toBe(true);
	});
	it('rejects foreign origins', () => {
		expect(isAllowedStorageUrl('https://evil.com/api/storage/abc', cloud)).toBe(false);
		// look-alike host must not match
		expect(
			isAllowedStorageUrl('https://jovial-sturgeon-545.convex.cloud.evil.com/api/storage/x', cloud)
		).toBe(false);
	});
	it('rejects non-storage paths', () => {
		expect(isAllowedStorageUrl(`${cloud}/api/run/foo`, cloud)).toBe(false);
	});
	it('rejects unparsable URLs and a missing cloud origin (fail closed)', () => {
		expect(isAllowedStorageUrl('not a url', cloud)).toBe(false);
		expect(isAllowedStorageUrl(`${cloud}/api/storage/abc`, undefined)).toBe(false);
	});
});

describe('client / server MIME allowlist parity', () => {
	// Guard: every MIME the client offers for upload must also be accepted by the
	// server validators, or uploads of that type get rejected after the round-trip.
	const serverList = (relativePath: string): string[] => {
		const path = fileURLToPath(new URL(relativePath, import.meta.url));
		const source = readFileSync(path, 'utf8');
		const match = source.match(/const ALLOWED_MIME_TYPES = \[([\s\S]*?)\]/);
		if (!match) throw new Error(`ALLOWED_MIME_TYPES not found in ${relativePath}`);
		return [...match[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
	};

	const clientMimes = [...new Set(Object.values(ALLOWED_FILE_EXT_MIME))];

	it.each([['../../convex/support/files.ts'], ['../../convex/aiChat/files.ts']])(
		'%s accepts every client-offered MIME',
		(relativePath) => {
			const allowed = serverList(relativePath);
			for (const mime of clientMimes) {
				expect(allowed).toContain(mime);
			}
		}
	);

	it('exposes the new text types in the derived client lists', () => {
		expect(ALLOWED_FILE_EXT_MIME['.md']).toBe('text/markdown');
		expect(ALLOWED_FILE_EXT_MIME['.txt']).toBe('text/plain');
		expect(ALLOWED_FILE_TYPES).toContain('text/markdown');
		expect(ALLOWED_FILE_TYPES).toContain('text/plain');
	});
});
