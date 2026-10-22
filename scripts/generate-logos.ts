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
 * The outputs are committed. After changing static/logo.svg, run
 * `bun run generate:logos` and commit the result; generate-logos.test.ts fails
 * while a committed file differs from what the source renders to.
 *
 * Usage: bun scripts/generate-logos.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const ROOT = join(import.meta.dirname, '..');

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

// Browser-tab favicons get ~6% breathing room around the glyph.
const FAVICON_PADDING_RATIO = 0.06;
const BRAND = '#09090b';
const BRAND_DARK = '#e4e4e7'; // zinc-200 — favicon.svg stroke on dark browser tabs

/** PNGs rendered from logo.svg, by file name under static/. */
const PNGS: Array<{ out: string } & RenderOpts> = [
	// Email logo (4x retina for 28px display): white rounded-rect background and a
	// black logo, immune to email-client dark-mode color inversion.
	{
		out: 'logo-email.png',
		size: 112,
		padding: 16,
		cornerRadius: 20, // ≈5px at 28px display size
		background: '#ffffff',
		color: 'black'
	},
	// PWA / home-screen icons: brand-colored logo on a white background.
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
	},
	// 96x96 favicon fallback for non-SVG, non-ICO consumers, on a transparent ground.
	{
		out: 'favicon-96x96.png',
		size: 96,
		padding: Math.round(96 * FAVICON_PADDING_RATIO),
		cornerRadius: 0,
		background: null,
		color: BRAND
	}
];

/**
 * Renders every logo asset from the source SVG, keyed by file name under static/.
 * The browser-tab favicons are derived from the same source so they can never drift from it.
 */
export function renderLogoAssets(source: string): Map<string, Buffer | string> {
	const assets = new Map<string, Buffer | string>();
	for (const { out, ...opts } of PNGS) {
		assets.set(out, renderToBuffer(source, opts));
	}
	// Vector favicon (dark-mode adaptive; modern browsers prefer this).
	assets.set('favicon.svg', buildFaviconSvg(source, BRAND, BRAND_DARK));
	// Multi-size ICO (16/32/48) for the bare /favicon.ico request and legacy UAs.
	assets.set(
		'favicon.ico',
		buildIco(
			[16, 32, 48].map((size) => ({
				size,
				png: renderToBuffer(source, {
					size,
					padding: Math.max(1, Math.round(size * FAVICON_PADDING_RATIO)),
					cornerRadius: 0,
					background: null,
					color: BRAND
				})
			}))
		)
	);
	return assets;
}

if (import.meta.main) {
	for (const [file, content] of renderLogoAssets(
		readFileSync(join(ROOT, 'static/logo.svg'), 'utf-8')
	)) {
		writeFileSync(join(ROOT, 'static', file), content);
		console.log(`Generated static/${file}`);
	}
	console.log(
		'\nAfter a brand change, validate at https://realfavicongenerator.net/favicon-checker'
	);
}
