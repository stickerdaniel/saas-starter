/**
 * Stamp the OG image's content hash into the URL SEOHead advertises.
 *
 * Social platforms cache the preview image separately from the page it belongs
 * to, keyed on the image URL. Replacing static/og-image.png therefore does not
 * reach anywhere the link was already shared: re-scraping the page refreshes
 * the title and description and keeps serving the previously fetched bytes.
 * Moving the URL with the file is what invalidates those caches.
 *
 * Run after replacing static/og-image.png:
 *   bun run generate:og-image-url
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const IMAGE_PATH = resolve(import.meta.dirname!, '../static/og-image.png');
const OUTPUT_PATH = resolve(
	import.meta.dirname!,
	'../src/lib/components/og-image-url.generated.ts'
);

export const hashImage = (bytes: Buffer): string =>
	createHash('sha256').update(bytes).digest('hex').slice(0, 8);

export const renderModule = (hash: string): string => `// GENERATED FILE — do not edit manually.
// Run \`bun run generate:og-image-url\` after replacing static/og-image.png.
// Source: scripts/generate-og-image-url.ts

// The query string is the image's content hash. Social platforms cache the
// preview image under its URL, so an unchanged URL keeps serving the old card
// everywhere the link was already shared.
export const OG_IMAGE_URL = '/og-image.png?v=${hash}';
`;

if (import.meta.main) {
	const hash = hashImage(readFileSync(IMAGE_PATH));
	writeFileSync(OUTPUT_PATH, renderModule(hash));
	console.log(`✓ /og-image.png?v=${hash} → ${OUTPUT_PATH}`);
}
