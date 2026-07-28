import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve('src/lib/chat/ui/ChatAttachments.svelte'), 'utf8');

/**
 * Both keyed lists must identify composer attachments by their upload id.
 * Name and size are not unique: photo.jpg and photo.jpeg pass dedup as
 * different source names, then preprocessing renames both to photo.webp at the
 * same encoded size, and Svelte throws each_key_duplicate.
 *
 * Pinned in source because reproducing it in a browser test needs two images
 * that survive dedup and then encode to byte-identical sizes, which is fragile
 * to arrange and would break for reasons unrelated to the keying.
 */
describe('ChatAttachments keyed lists', () => {
	it('keys every each block by the shared attachment identity', () => {
		// The key is the final parenthesised expression of an {#each ...} tag.
		const keyExpressions = [...source.matchAll(/\{#each .*?\(([A-Za-z]+\(attachment\))\)\}/g)].map(
			(match) => match[1]
		);

		expect(keyExpressions.length).toBe(2);
		for (const expression of keyExpressions) {
			expect(expression).toBe('attachmentKey(attachment)');
		}
	});

	it('prefers the upload id over the derived name+size key', () => {
		const helper = source.match(
			/function attachmentKey\(attachment: Attachment\): string \{([^}]*)\}/s
		)?.[1];

		expect(helper).toBeDefined();
		expect(helper).toContain('attachment.key');
		// Sent attachments carry no id, so the derived key stays as the fallback.
		expect(helper).toContain('getKey(attachment)');
	});
});
