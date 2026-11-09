import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import postcss, { type ChildNode, type Container } from 'postcss';
import { normalizePath, type Plugin } from 'vite';

const MODULE = 'virtual:desk-computer-frame.css';
const COMPONENT_DIR = 'src/lib/components/desk-computer';
const COMPONENT = `${COMPONENT_DIR}/DeskComputer.svelte`;
const FIGURE = `${COMPONENT_DIR}/desk-computer.svg`;
const LAYOUT = 'src/routes/layout.css';
const SOURCES = [LAYOUT, COMPONENT, FIGURE];
// The virtual stylesheet sits beside the component, so dev serves it from a source URL and
// the build names the emitted asset after it.
const FRAME = `${COMPONENT_DIR}/desk-computer-frame.css`;

type Tokens = Map<string, string>;

/** The files the frame derives from, as text. */
export interface FrameSources {
	/** The app stylesheet with the theme's `:root`, `.dark` and `@theme` custom properties. */
	layout: string;
	/** DeskComputer.svelte, whose `<style>` holds the anatomy tokens and paint rules. */
	component: string;
	/** The figure's markup. */
	figure: string;
	/** Tailwind's default theme, the lowest layer of custom properties. */
	tailwindTheme: string;
}

const compact = (text: string) => text.replaceAll(/\s+/g, ' ').trim();

function collect(container: Container, into: Tokens) {
	for (const node of container.nodes ?? []) {
		if (node.type === 'decl' && node.prop.startsWith('--'))
			into.set(node.prop, compact(node.value));
	}
}

function serialize(node: ChildNode): string {
	if (node.type === 'decl') return `${node.prop}:${compact(node.value)}`;
	if (node.type === 'rule') {
		const body = node.nodes.filter((child) => child.type !== 'comment').map(serialize);
		return `${compact(node.selector)}{${body.join(';')}}`;
	}
	return '';
}

/** Custom properties of a stylesheet's top-level `@theme` blocks, `:root` and `.dark` rules. */
function themeLayers(css: string) {
	const theme: Tokens = new Map();
	const root: Tokens = new Map();
	const dark: Tokens = new Map();
	for (const node of postcss.parse(css).nodes) {
		if (node.type === 'atrule' && node.name === 'theme') collect(node, theme);
		if (node.type === 'rule' && node.selector === ':root') collect(node, root);
		if (node.type === 'rule' && node.selector === '.dark') collect(node, dark);
	}
	return { theme, root, dark };
}

function componentRules(component: string) {
	const style = /<style[^>]*>([\s\S]*?)<\/style>/.exec(component)?.[1];
	if (style === undefined) throw new Error(`${COMPONENT} needs a <style> block.`);
	const rules = new Map<string, Container>();
	for (const node of postcss.parse(style).nodes) {
		if (node.type === 'rule') rules.set(compact(node.selector), node);
	}
	const rule = (selector: string) => {
		const found = rules.get(selector);
		if (!found) {
			throw new Error(
				`${COMPONENT} needs a \`${selector}\` rule in its <style>: the desk computer's stylesheet frame reads the figure's tokens and paint rules from it.`
			);
		}
		return found;
	};
	const base: Tokens = new Map();
	const dark: Tokens = new Map();
	collect(rule('.desk-computer'), base);
	collect(rule(':global(.dark) .desk-computer'), dark);
	const paint = (rule('.desk-computer :global').nodes ?? [])
		.filter((node) => node.type !== 'comment')
		.map(serialize)
		.join('');
	return { base, dark, paint };
}

/**
 * The custom properties `css` reaches through `var()`, transitively. A reference without
 * a fallback must resolve, or the frame would paint other colours than the page.
 */
function reachable(css: string, tokens: Tokens): string {
	const picked: Tokens = new Map();
	const pending = [css];
	for (let text = pending.pop(); text !== undefined; text = pending.pop()) {
		for (const [, name, fallback] of text.matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)) {
			if (!name || picked.has(name)) continue;
			const value = tokens.get(name);
			if (value === undefined) {
				if (fallback) continue;
				throw new Error(
					`The desk computer figure uses ${name}, which neither ${LAYOUT} (top-level :root, .dark or @theme) nor ${COMPONENT} defines.`
				);
			}
			picked.set(name, value);
			pending.push(value);
		}
	}
	return [...picked].map(([name, value]) => `${name}:${value}`).join(';');
}

// The inline figure is parsed as HTML, an image as XML: value-less attributes get an empty
// value. Single quotes around the values spare the escapes a CSS minifier would add to them
// inside its double-quoted url().
const asXml = (svg: string) =>
	svg.replaceAll(/<[a-zA-Z][^>]*>/g, (tag) =>
		tag.replaceAll(
			/(\s[\w:.-]+)(?:="([^"]*)")?/g,
			(_, name: string, value = '') => `${name}='${value.replaceAll("'", '&apos;')}'`
		)
	);

// Percent-encodes what a data URL or the double-quoted CSS string around it cannot carry raw.
const dataUrl = (svg: string) =>
	`data:image/svg+xml,${svg.replaceAll(/[%#"<>\\]|[^\x20-\x7e]/gu, encodeURIComponent)}`;

/**
 * The stylesheet that paints the desk computer before its live markup arrives: one SVG
 * image per theme, each carrying the theme's tokens and the component's paint rules so
 * the browser resolves the same colours as for the inline figure.
 */
export function deskComputerFrameCss(sources: FrameSources): string {
	const figure = sources.figure.replaceAll(/<!--[\s\S]*?-->/g, '').trim();
	const viewBox = /<svg\b[^>]*\bviewBox="([^"]+)"/
		.exec(figure)?.[1]
		?.trim()
		.split(/\s+/)
		.map(Number);
	if (viewBox?.length !== 4 || viewBox.some(Number.isNaN)) {
		throw new Error(`${FIGURE} needs a root <svg> with a numeric viewBox.`);
	}
	const [x, y, width, height] = viewBox as [number, number, number, number];

	const layout = themeLayers(sources.layout);
	const { base, dark, paint } = componentRules(sources.component);
	const light: Tokens = new Map([
		...themeLayers(sources.tailwindTheme).theme,
		...layout.theme,
		...layout.root,
		...base
	]);
	// The image's viewBox extends below the figure and is sliced from the top left, so the
	// figure scales with the host's width alone and keeps its place in a tile of any height.
	const frame = (tokens: Tokens) =>
		dataUrl(
			asXml(figure).replace(
				/<svg\b[^>]*>/,
				(open) =>
					`${open.replace(/\sviewBox='[^']*'/, ` viewBox='${x} ${y} ${width} ${2 * height}' preserveAspectRatio='xMinYMin slice'`)}` +
					`<style><![CDATA[:root{${reachable(paint, tokens)}}${paint}]]></style>`
			)
		);

	// `:empty` holds the frame until the component fills the host with the live figure. The
	// image box rounds its height up to whole pixels: browsers fit a fractional background
	// tile to the pixel grid, which would scale the figure off the inline one's lines.
	// `contain: layout` anchors the box to the host wherever the host is placed.
	return (
		`.desk-computer:empty{aspect-ratio:${width}/${height};contain:layout}` +
		'.desk-computer:empty::before{content:"";position:absolute;top:0;left:0;width:100%;height:round(up,100%,1px);' +
		`background:url("${frame(light)}") 0 0/100% 100% no-repeat}` +
		`.dark .desk-computer:empty::before{background-image:url("${frame(new Map([...light, ...layout.dark, ...dark]))}")}`
	);
}

/**
 * Serves `virtual:desk-computer-frame.css`, the desk computer's first-paint stylesheet,
 * derived from the current theme and figure sources. Import it with `?url` and link it from
 * the document head: dev serves it from source on every request, the build emits it as a
 * hashed asset.
 */
export function deskComputerFrame(): Plugin {
	let root = '';
	const file = () => `${root}/${FRAME}`;
	return {
		name: 'desk-computer-frame',
		enforce: 'pre',
		configResolved(config) {
			root = normalizePath(config.root);
		},
		resolveId: {
			filter: { id: /desk-computer-frame\.css(?:$|\?)/ },
			handler(source) {
				const [id, query] = source.split('?', 2);
				if (id === MODULE || id === file() || id === `/${FRAME}`) {
					return query === undefined ? file() : `${file()}?${query}`;
				}
			}
		},
		load: {
			filter: { id: /desk-computer-frame\.css(?:$|\?)/ },
			async handler(id) {
				const [path, query] = id.split('?', 2);
				// Vite's CSS and asset plugins answer `?url` with the stylesheet's address.
				if (path !== file() || new URLSearchParams(query).has('url')) return;
				const read = (relative: string) => {
					this.addWatchFile(`${root}/${relative}`);
					return readFile(`${root}/${relative}`, 'utf8');
				};
				const tailwindTheme = createRequire(`${root}/package.json`).resolve(
					'tailwindcss/theme.css'
				);
				return deskComputerFrameCss({
					layout: await read(LAYOUT),
					component: await read(COMPONENT),
					figure: await read(FIGURE),
					tailwindTheme: await readFile(tailwindTheme, 'utf8')
				});
			}
		},
		// Nothing imports the stylesheet's content, so dev drops it by hand when a source
		// changes; the next page load fetches the new frame.
		hotUpdate({ file: changed }) {
			if (!SOURCES.some((source) => changed === `${root}/${source}`)) return;
			const graph = this.environment.moduleGraph;
			for (const module of graph.getModulesByFile(file()) ?? []) graph.invalidateModule(module);
		}
	};
}
