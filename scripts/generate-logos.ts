/**
 * Generate logo and PWA icon PNGs from SVG source.
 *
 * Produces:
 * - static/logo-email.png — the logo on a white rounded-rect background,
 *   immune to email-client dark-mode color inversion.
 * - static/apple-touch-icon.png, static/icon-192.png, static/icon-512.png,
 *   static/icon-512-maskable.png — PWA / home-screen icons.
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

function renderPng(source: string, out: string, o: RenderOpts): void {
	try {
		const wrapperSvg = buildWrapperSvg(source, o);
		const resvg = new Resvg(wrapperSvg, {
			fitTo: { mode: 'width', value: o.size }
		});
		const png = resvg.render().asPng();
		writeFileSync(join(ROOT, 'static', out), png);
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
