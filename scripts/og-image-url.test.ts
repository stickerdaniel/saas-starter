import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hashImage, renderModule } from './generate-og-image-url';
import { OG_IMAGE_URL } from '../src/lib/components/og-image-url.generated';

const root = resolve(import.meta.dirname, '..');
const image = readFileSync(resolve(root, 'static/og-image.png'));
const generated = readFileSync(
	resolve(root, 'src/lib/components/og-image-url.generated.ts'),
	'utf8'
);

// Replacing the image without regenerating the URL is invisible while
// developing — the meta tag still resolves to the new file — and only shows up
// as an unchanged preview card in every chat the link was ever pasted into.
describe('og-image URL', () => {
	it('carries the current image content hash', () => {
		expect(OG_IMAGE_URL).toBe(`/og-image.png?v=${hashImage(image)}`);
	});

	it('matches what the generator would write', () => {
		expect(generated).toBe(renderModule(hashImage(image)));
	});
});
