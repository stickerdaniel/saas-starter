import { posix } from 'node:path';
import type { MoveTable } from '../../.agents/skills/upstream-sync/layout/v3.ts';

const GLOB = /[*?{[]/;
const QUOTED = /(['"])((?:(?!\1)[^\\\n]|\\.)*)\1/g;

function globRegExp(pattern: string): RegExp {
	let source = '';
	for (let at = 0; at < pattern.length; at++) {
		const char = pattern[at]!;
		if (pattern.startsWith('**/', at)) {
			source += '(?:.*/)?';
			at += 2;
		} else if (pattern.startsWith('**', at)) {
			source += '.*';
			at += 1;
		} else if (char === '*') source += '[^/]*';
		else if (char === '?') source += '[^/]';
		else if (char === '{') source += '(?:';
		else if (char === '}') source += ')';
		else if (char === ',' && source.includes('(?:')) source += '|';
		else source += char.replace(/[.+^$()|[\]\\]/g, '\\$&');
	}
	return new RegExp(`^${source}$`);
}

function directoryImage(table: MoveTable, directory: string, rest: string): string[] | undefined {
	const governing = table.place(directory)?.rule;
	const inner = table.rules.filter(
		(rule) => rule.from.startsWith(directory) && rule.from !== directory
	);
	if (!governing && !inner.length) return undefined;
	const images: string[] = [];
	if (governing?.to) images.push(governing.to + directory.slice(governing.from.length) + rest);
	const matches =
		rest === '' ? () => true : (path: string) => globRegExp(directory + rest).test(path);
	for (const rule of inner) {
		if (rule.to === null) continue;
		if (!rule.from.endsWith('/')) {
			if (matches(rule.from)) images.push(rule.to);
		} else if (rest === '' || rest.startsWith('**')) {
			images.push(rule.to + rest);
		} else if (rest.includes('/')) {
			return undefined;
		}
	}
	const unique = [...new Set(images)];
	const covers = (other: string, image: string) => {
		if (other === image || !other.endsWith(rest)) return false;
		const base = other.slice(0, other.length - rest.length);
		if (!base.endsWith('/') || !image.startsWith(base)) return false;
		return image.endsWith(rest) || globRegExp(other).test(image);
	};
	return unique.filter((image) => !unique.some((other) => covers(other, image)));
}

export function globImage(table: MoveTable, pattern: string): string[] | undefined {
	const negation = pattern.startsWith('!') ? '!' : '';
	const lead = pattern.slice(negation.length).startsWith('./') ? './' : '';
	const glob = pattern.slice(negation.length + lead.length);
	if (glob === '' || glob.startsWith('**') || glob.startsWith('/') || glob.startsWith('../')) {
		return undefined;
	}
	const firstGlob = glob.search(GLOB);
	let images: string[] | undefined;
	if (firstGlob !== -1) {
		const directory = glob.slice(0, glob.lastIndexOf('/', firstGlob) + 1);
		if (directory === '') return undefined;
		images = directoryImage(table, directory, glob.slice(directory.length));
	} else if (glob.endsWith('/') || !/\.[^/]+$/.test(glob)) {
		const directory = glob.endsWith('/') ? glob : `${glob}/`;
		images = directoryImage(table, directory, '')?.map((image) =>
			glob.endsWith('/') || !image.endsWith('/') ? image : image.slice(0, -1)
		);
	} else {
		const placed = table.place(glob);
		images = placed === undefined ? undefined : placed.to === null ? [] : [placed.to];
	}
	if (images === undefined || (images.length === 1 && images[0] === glob)) return undefined;
	return images.map((image) => negation + lead + image);
}

export interface Imaged {
	readonly text: string;
	readonly problems: readonly string[];
}

const before = (text: string, at: number) =>
	text
		.slice(0, at)
		.split('\n')
		.filter((line, index, lines) => index === lines.length - 1 || !line.trim().startsWith('//'))
		.join('\n')
		.trimEnd()
		.at(-1);
const after = (text: string, at: number) => text.slice(at).trimStart()[0];

const DROPPED = '\u0000';
const SYNTHETIC_ROOT = '/repo/';

function literalImage(
	table: MoveTable,
	from: string,
	to: string,
	value: string
): string[] | undefined {
	if (value.startsWith(SYNTHETIC_ROOT)) {
		return globImage(table, value.slice(SYNTHETIC_ROOT.length))?.map(
			(image) => SYNTHETIC_ROOT + image
		);
	}
	if (!/^\.\.?\//.test(value)) return globImage(table, value);
	const resolved = posix.join(posix.dirname(from), value);
	if (resolved.startsWith('../')) return undefined;
	return globImage(table, resolved)?.map((image) => {
		const relative = posix.relative(posix.dirname(to), image) + (image.endsWith('/') ? '/' : '');
		return relative.startsWith('.') ? relative : `./${relative}`;
	});
}

export function imageLiterals(
	table: MoveTable,
	{ from, to }: { readonly from: string; readonly to: string },
	text: string,
	within?: `${string}/`
): Imaged {
	const path = to;
	const problems: string[] = [];
	const result = text.replace(QUOTED, (literal, quote: string, value: string, at: number) => {
		const moved = literalImage(table, from, to, value);
		if (moved === undefined) return literal;
		const negation = value.startsWith('!') ? '!' : '';
		const images = within
			? moved
					.map((image) => image.slice(negation.length))
					.filter((image) => image.startsWith(within))
					.map((image) => negation + image.slice(within.length))
			: moved;
		const inArray =
			['[', ','].includes(before(text, at) ?? '') &&
			[',', ']'].includes(after(text, at + literal.length) ?? '');
		if (images.length !== 1 && !inArray) {
			const line = text.slice(0, at).split('\n').length;
			problems.push(
				`${path}:${line} names ${value}, whose image is ${images.length ? images.join(', ') : 'empty'}`
			);
			return literal;
		}
		if (!images.length) return DROPPED;
		return images.map((image) => `${quote}${image}${quote}`).join(', ');
	});
	return {
		text: result
			.replace(new RegExp(`${DROPPED}\\s*,\\s*`, 'g'), '')
			.replace(new RegExp(`,?\\s*${DROPPED}`, 'g'), ''),
		problems
	};
}

export function imageLines(table: MoveTable, text: string): string {
	return text
		.split('\n')
		.flatMap((line) => {
			const negation = line.startsWith('!') ? '!' : '';
			const body = line.slice(negation.length);
			const slash = body.startsWith('/') ? '/' : '';
			const pattern = body.slice(slash.length);
			if (line.startsWith('#') || (!pattern.slice(0, -1).includes('/') && !slash)) return [line];
			return globImage(table, pattern)?.map((image) => negation + slash + image) ?? [line];
		})
		.join('\n');
}
