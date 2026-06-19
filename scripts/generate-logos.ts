/**
 * Generate logo and PWA icon PNGs from SVG source.
 *
 * Produces:
 * - static/logo-email.png — the logo on a white rounded-rect background,
 *   immune to email-client dark-mode color inversion.
 * - static/apple-touch-icon.png, static/icon-192.png, static/icon-512.png,
 *   static/icon-512-maskable.png — PWA / home-screen icons.
 * - static/favicon.svg, static/favicon-96x96.png, static/favicon.ico —
 *   browser-tab favicons (dark-mode vector + raster + multi-size ICO).
 *
 * Usage: bun scripts/generate-logos.ts
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SVG_PATH = join(ROOT, 'static/logo.svg');
const OUT_PATH = join(ROOT, 'static/logo-email.png');

// Email output size (4x retina for 28px email display)
const SIZE = 112;
const PADDING = 16; // padding around logo inside the background
const CORNER_RADIUS = 20; // ≈5px at 28px display size

// Structural attributes that belong on the wrapper <svg>, not on <g>
const STRUCTURAL_ATTRS = new Set(['width', 'height', 'viewBox', 'class', 'id', 'version']);

function isNamespaceAttr(name: string): boolean {
	return name === 'xmlns' || name.startsWith('xmlns:');
}

function parseRootAttributes(svgContent: string): {
	namespaceAttrs: Record<string, string>;
	presentationAttrs: Record<string, string>;
	viewBox: string | null;
	width: string | null;
	height: string | null;
	innerContent: string;
} {
	// Extract the opening <svg> tag (with or without attributes)
	const svgTagMatch = svgContent.match(/<svg(\s[^>]*)?\s*>/s);
	if (!svgTagMatch) {
		throw new Error('Could not parse <svg> tag from source');
	}

	const attrsString = svgTagMatch[1]?.trim() ?? '';
	const namespaceAttrs: Record<string, string> = {};
	const presentationAttrs: Record<string, string> = {};
	let viewBox: string | null = null;
	let width: string | null = null;
	let height: string | null = null;

	// Parse attributes from the <svg> tag
	const attrRegex = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
	let match;
	while ((match = attrRegex.exec(attrsString)) !== null) {
		const [, name, doubleQ, singleQ] = match;
		const value = doubleQ ?? singleQ;
		if (name === 'viewBox') {
			viewBox = value;
		} else if (name === 'width') {
			width = value;
		} else if (name === 'height') {
			height = value;
		} else if (isNamespaceAttr(name)) {
			namespaceAttrs[name] = value;
		} else if (!STRUCTURAL_ATTRS.has(name)) {
			// Keep currentColor verbatim; the wrapper builder swaps it per render.
			presentationAttrs[name] = value;
		}
	}

	// Ensure xmlns is always present
	if (!namespaceAttrs['xmlns']) {
		namespaceAttrs['xmlns'] = 'http://www.w3.org/2000/svg';
	}

	// Extract inner content (everything between <svg> and </svg>)
	const innerMatch = svgContent.match(/<svg(?:\s[^>]*)?\s*>([\s\S]*)<\/svg>/);
	const innerContent = innerMatch ? innerMatch[1] : '';

	return { namespaceAttrs, presentationAttrs, viewBox, width, height, innerContent };
}

interface RenderOpts {
	size: number;
	padding: number;
	cornerRadius: number;
	background: string | null;
	color: string;
}

function buildWrapperSvg(source: string, o: RenderOpts): string {
	const { namespaceAttrs, presentationAttrs, viewBox, width, height, innerContent } =
		parseRootAttributes(source);

	// Resolve canvas dimensions: viewBox > width/height > error
	let minX = 0;
	let minY = 0;
	let vbWidth: number;
	let vbHeight: number;

	if (viewBox) {
		[minX, minY, vbWidth, vbHeight] = viewBox.split(/\s+/).map(Number);
	} else if (width && height) {
		vbWidth = parseFloat(width);
		vbHeight = parseFloat(height);
	} else {
		throw new Error(
			'Source SVG has no viewBox or width/height attributes. Cannot determine canvas dimensions.'
		);
	}

	// Calculate logo positioning within the output, accounting for viewBox origin
	const logoSize = o.size - o.padding * 2; // area available for the logo
	const scale = logoSize / Math.max(vbWidth, vbHeight);
	const logoW = vbWidth * scale;
	const logoH = vbHeight * scale;
	const offsetX = (o.size - logoW) / 2 - minX * scale;
	const offsetY = (o.size - logoH) / 2 - minY * scale;

	// Build namespace attributes string
	const nsAttrs = Object.entries(namespaceAttrs)
		.map(([k, v]) => `${k}="${v}"`)
		.join(' ');

	// Build presentation attributes string for <g>, swapping currentColor per render
	const presAttrs = Object.entries(presentationAttrs)
		.map(([k, v]) => `${k}="${v.replace(/currentColor/g, o.color)}"`)
		.join(' ');

	const innerColored = innerContent.replace(/currentColor/g, o.color);
	const rect = o.background
		? `<rect width="${o.size}" height="${o.size}"${o.cornerRadius > 0 ? ` rx="${o.cornerRadius}"` : ''} fill="${o.background}"/>`
		: '';

	return `<svg ${nsAttrs} width="${o.size}" height="${o.size}" viewBox="0 0 ${o.size} ${o.size}">
  ${rect}
  <g transform="translate(${offsetX}, ${offsetY}) scale(${scale})" ${presAttrs}>
    ${innerColored}
  </g>
</svg>`;
}

/** Core resvg render: wrapper SVG -> PNG Buffer. Shared by every PNG output. */
function renderToBuffer(source: string, o: RenderOpts): Buffer {
	const wrapperSvg = buildWrapperSvg(source, o);
	const resvg = new Resvg(wrapperSvg, { fitTo: { mode: 'width', value: o.size } });
	return Buffer.from(resvg.render().asPng());
}

function renderPng(source: string, out: string, o: RenderOpts): void {
	try {
		writeFileSync(join(ROOT, 'static', out), renderToBuffer(source, o));
		console.log(`Generated static/${out} (${o.size}x${o.size})`);
	} catch (err) {
		// Keep any already-committed PNG so a render failure (e.g. postinstall on
		// an unsupported platform) does not break the build.
		if (existsSync(join(ROOT, 'static', out))) {
			console.warn(
				`⚠️  Could not regenerate static/${out} (${err instanceof Error ? err.message : err})`
			);
			console.warn('   Using existing committed file.');
		} else {
			throw err;
		}
	}
}

/**
 * Build the browser-tab favicon SVG from the same source as every other icon.
 * Single fixed stroke color (light tabs) plus a dark-mode @media override, so
 * the vector favicon tracks logo.svg automatically and never drifts.
 */
function buildFaviconSvg(source: string, light: string, dark: string): string {
	const { namespaceAttrs, presentationAttrs, viewBox, width, height, innerContent } =
		parseRootAttributes(source);

	const vb = viewBox ?? (width && height ? `0 0 ${width} ${height}` : '0 0 24 24');
	const nsAttrs = Object.entries(namespaceAttrs)
		.map(([k, v]) => `${k}="${v}"`)
		.join(' ');
	// Pin presentation attrs (stroke-width, linecap, fill=none, ...) onto the root,
	// swapping the source's currentColor stroke for the fixed light-tab color.
	const presAttrs = Object.entries(presentationAttrs)
		.map(([k, v]) => `${k}="${v.replace(/currentColor/g, light)}"`)
		.join(' ');
	// Only currentColor is swapped here; path `d=` values pass through byte-for-byte.
	// pwa-manifest.test.ts asserts every logo.svg path appears verbatim in
	// favicon.svg, so any future normalization step here must keep `d=` untouched.
	const inner = innerContent.replace(/currentColor/g, light).trim();

	return `<svg ${nsAttrs} viewBox="${vb}" ${presAttrs}>
  <style>
    /* Brand mark: ${light} on light tabs, ${dark} on dark tabs */
    @media (prefers-color-scheme: dark) {
      path { stroke: ${dark}; }
    }
  </style>
  ${inner}
</svg>
`;
}

/**
 * Assemble a PNG-in-ICO container (no external dependency).
 * Layout: ICONDIR (6B) + N * ICONDIRENTRY (16B) + concatenated PNG payloads.
 * Each entry stores a whole PNG, supported by all current browsers and OSes.
 */
function buildIco(entries: Array<{ size: number; png: Buffer }>): Buffer {
	const count = entries.length;
	const header = Buffer.alloc(6);
	header.writeUInt16LE(0, 0); // reserved
	header.writeUInt16LE(1, 2); // type 1 = icon
	header.writeUInt16LE(count, 4); // image count

	const dir = Buffer.alloc(16 * count);
	let offset = 6 + 16 * count; // payloads start after the full directory
	entries.forEach(({ size, png }, i) => {
		const e = dir.subarray(i * 16, i * 16 + 16);
		e.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 means 256)
		e.writeUInt8(size >= 256 ? 0 : size, 1); // height (0 means 256)
		e.writeUInt8(0, 2); // color count (0 for truecolor)
		e.writeUInt8(0, 3); // reserved
		e.writeUInt16LE(1, 4); // color planes
		e.writeUInt16LE(32, 6); // bits per pixel
		e.writeUInt32LE(png.length, 8); // bytes in resource
		e.writeUInt32LE(offset, 12); // absolute offset of this PNG
		offset += png.length;
	});

	return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

// --- Main ---

const { Resvg } = await import('@resvg/resvg-js');
const svgSource = readFileSync(SVG_PATH, 'utf-8');

// Email logo: white rounded-rect background, black logo (dark-mode safe).
try {
	const wrapperSvg = buildWrapperSvg(svgSource, {
		size: SIZE,
		padding: PADDING,
		cornerRadius: CORNER_RADIUS,
		background: '#ffffff',
		color: 'black'
	});

	const resvg = new Resvg(wrapperSvg, {
		fitTo: { mode: 'width', value: SIZE }
	});
	const png = resvg.render().asPng();

	writeFileSync(OUT_PATH, png);
	console.log(`Generated ${OUT_PATH} (${SIZE}x${SIZE})`);
} catch (err) {
	if (existsSync(OUT_PATH)) {
		console.warn(
			`⚠️  Could not regenerate logo-email.png (${err instanceof Error ? err.message : err})`
		);
		console.warn('   Using existing committed file.');
	} else {
		throw err;
	}
}

// PWA / home-screen icons: brand-colored logo on a white background.
const BRAND = '#09090b';
const BRAND_DARK = '#e4e4e7'; // zinc-200 — favicon.svg stroke on dark browser tabs
const ICONS: Array<{ out: string } & RenderOpts> = [
	{
		out: 'apple-touch-icon.png',
		size: 180,
		padding: 24,
		cornerRadius: 0,
		background: '#ffffff',
		color: BRAND
	},
	{
		out: 'icon-192.png',
		size: 192,
		padding: 24,
		cornerRadius: 38,
		background: '#ffffff',
		color: BRAND
	},
	{
		out: 'icon-512.png',
		size: 512,
		padding: 64,
		cornerRadius: 102,
		background: '#ffffff',
		color: BRAND
	},
	{
		out: 'icon-512-maskable.png',
		size: 512,
		padding: 102,
		cornerRadius: 0,
		background: '#ffffff',
		color: BRAND
	}
];

for (const { out, ...opts } of ICONS) {
	renderPng(svgSource, out, opts);
}

// Browser-tab favicons: vector + multi-size ICO + a 96px PNG fallback, all on a
// transparent ground and derived from logo.svg so they can never drift from it.
const FAVICON_PADDING_RATIO = 0.06; // ~6% breathing room around the glyph

// 1. Vector favicon (dark-mode adaptive; modern browsers prefer this).
try {
	writeFileSync(join(ROOT, 'static/favicon.svg'), buildFaviconSvg(svgSource, BRAND, BRAND_DARK));
	console.log('Generated static/favicon.svg');
} catch (err) {
	if (existsSync(join(ROOT, 'static/favicon.svg'))) {
		console.warn(
			`⚠️  Could not regenerate static/favicon.svg (${err instanceof Error ? err.message : err})`
		);
		console.warn('   Using existing committed file.');
	} else {
		throw err;
	}
}

// 2. 96x96 PNG fallback for non-SVG, non-ICO consumers.
renderPng(svgSource, 'favicon-96x96.png', {
	size: 96,
	padding: Math.round(96 * FAVICON_PADDING_RATIO),
	cornerRadius: 0,
	background: null,
	color: BRAND
});

// 3. Multi-size ICO (16/32/48) for the bare /favicon.ico request and legacy UAs.
try {
	const icoSizes = [16, 32, 48];
	const ico = buildIco(
		icoSizes.map((size) => ({
			size,
			png: renderToBuffer(svgSource, {
				size,
				padding: Math.max(1, Math.round(size * FAVICON_PADDING_RATIO)),
				cornerRadius: 0,
				background: null,
				color: BRAND
			})
		}))
	);
	writeFileSync(join(ROOT, 'static/favicon.ico'), ico);
	console.log(`Generated static/favicon.ico (${icoSizes.join('/')})`);
} catch (err) {
	if (existsSync(join(ROOT, 'static/favicon.ico'))) {
		console.warn(
			`⚠️  Could not regenerate static/favicon.ico (${err instanceof Error ? err.message : err})`
		);
		console.warn('   Using existing committed file.');
	} else {
		throw err;
	}
}

console.log(
	'\n→ After a brand change, validate at https://realfavicongenerator.net/favicon-checker'
);
