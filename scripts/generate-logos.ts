/**
 * Generate email logo PNG from SVG source.
 *
 * Produces static/logo-email.png — the logo on a white rounded-rect
 * background, immune to email-client dark-mode color inversion.
 *
 * Usage: bun scripts/generate-logos.ts
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SVG_PATH = join(ROOT, 'static/logo.svg');
const OUT_PATH = join(ROOT, 'static/logo-email.png');

// Output size (4x retina for 28px email display)
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
			// Replace currentColor with black for email rendering
			presentationAttrs[name] = value.replace(/currentColor/g, 'black');
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

function buildWrapperSvg(source: string): string {
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
	const logoSize = SIZE - PADDING * 2; // area available for the logo
	const scale = logoSize / Math.max(vbWidth, vbHeight);
	const logoW = vbWidth * scale;
	const logoH = vbHeight * scale;
	const offsetX = (SIZE - logoW) / 2 - minX * scale;
	const offsetY = (SIZE - logoH) / 2 - minY * scale;

	// Build namespace attributes string
	const nsAttrs = Object.entries(namespaceAttrs)
		.map(([k, v]) => `${k}="${v}"`)
		.join(' ');

	// Build presentation attributes string for <g>
	const presAttrs = Object.entries(presentationAttrs)
		.map(([k, v]) => `${k}="${v}"`)
		.join(' ');

	return `<svg ${nsAttrs} width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" rx="${CORNER_RADIUS}" fill="#ffffff"/>
  <g transform="translate(${offsetX}, ${offsetY}) scale(${scale})" ${presAttrs}>
    ${innerContent}
  </g>
</svg>`;
}

// --- Main ---

try {
	const { Resvg } = await import('@resvg/resvg-js');

	const svgSource = readFileSync(SVG_PATH, 'utf-8');
	const wrapperSvg = buildWrapperSvg(svgSource);

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
