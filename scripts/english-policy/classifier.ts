import { eld } from 'eld/extrasmall';

export interface LanguageDetector {
	detect(text: string): {
		getScores(): Record<string, number>;
	};
}

export interface LanguageScore {
	language: string;
	score: number;
}

export type EnglishClassification =
	| {
			outcome: 'violation';
			language: string;
			topScore: number;
			englishScore: number | null;
			normalizedText: string;
	  }
	| {
			outcome: 'accepted';
			reason: 'english-score' | 'technical-english';
			normalizedText: string;
	  }
	| {
			outcome: 'insufficient-evidence';
			reason: 'empty' | 'short' | 'ambiguous-score';
			normalizedText: string;
	  };

export interface TextWindow {
	text: string;
	line: number;
}

const detector = eld.newInstance();
const CONVENTIONAL_COMMIT =
	/^(?:build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(?:\([^)\r\n]+\))?!?:\s*/iu;
export const CODE_IDENTIFIER = /\b(?:[$_][\w$]*|[a-z]+[A-Z][\w$]*)\b/g;
const TECHNICAL_ACRONYMS = new Set([
	'API',
	'ASCII',
	'BUN',
	'CDN',
	'CI',
	'CLI',
	'CSS',
	'ELD',
	'HTML',
	'HTTP',
	'HTTPS',
	'JS',
	'JSON',
	'JSONC',
	'JWT',
	'JWKS',
	'PR',
	'SDK',
	'SSR',
	'SVELTE',
	'TS',
	'UI',
	'URL',
	'UTF'
]);
const SHORT_TECHNICAL_WORDS = new Set([
	'add',
	'allow',
	'api',
	'auth',
	'build',
	'bun',
	'bump',
	'cache',
	'check',
	'clean',
	'cli',
	'disable',
	'enable',
	'fix',
	'guard',
	'handle',
	'jwks',
	'load',
	'merge',
	'move',
	'parse',
	'password',
	'pin',
	'pr',
	'prevent',
	'remove',
	'rename',
	'reset',
	'restore',
	'retry',
	'run',
	'script',
	'scripts',
	'set',
	'skip',
	'support',
	'test',
	'token',
	'update',
	'use',
	'validate'
]);

type TechnicalReplacement = string | ((token: string) => string);

interface TrackedText {
	text: string;
	/** Source offset of every UTF-16 code unit in `text`. */
	offsets: number[];
}

interface SourceWord {
	text: string;
	offset: number;
}

const WORD = /\p{L}[\p{L}\p{M}'’-]*/gu;

function words(text: string): string[] {
	return text.match(WORD) ?? [];
}

function isTechnicalToken(token: string): boolean {
	const segments = token.split(/[_-]/u).filter(Boolean);
	return (
		segments.length > 0 &&
		segments.every((segment) => {
			if (/^V?\d+$/u.test(segment)) return true;
			const match = /^([A-Z]+)(?:V?\d+)?$/u.exec(segment);
			return match !== null && TECHNICAL_ACRONYMS.has(match[1]!);
		})
	);
}

function normalizeUppercaseToken(token: string): string {
	if (isTechnicalToken(token)) return ' ';
	return (token.match(/[A-Z]+/gu) ?? [])
		.filter((segment) => !TECHNICAL_ACRONYMS.has(segment))
		.join(' ');
}

function isShortTechnicalEnglish(text: string): boolean {
	const withoutPrefix = text.replace(CONVENTIONAL_COMMIT, '').trim();
	const tokens = words(withoutPrefix);
	return (
		tokens.length > 0 &&
		tokens.length <= 4 &&
		tokens.every(
			(token) => isTechnicalToken(token) || SHORT_TECHNICAL_WORDS.has(token.toLowerCase())
		)
	);
}

// Applied in order after NFKC normalization.
const TECHNICAL_SYNTAX: ReadonlyArray<readonly [RegExp, TechnicalReplacement]> = [
	[CONVENTIONAL_COMMIT, ''],
	[/```[\s\S]*?```|~~~[\s\S]*?~~~/g, ' '],
	// Like CommonMark, an inline code span may wrap across line breaks but not a blank line.
	[/`[^`\r\n]+(?:\r?\n[ \t]*[^`\s][^`\r\n]*)*`/g, ' '],
	[/https?:\/\/\S+|www\.\S+/giu, ' '],
	[/@[\w.-]+\/[\w.-]+/g, ' '],
	[/(?:[A-Za-z]:[\\/]|\.{0,2}[\\/])(?:[^\s<>"'`]+[\\/])*[^\s<>"'`]*/g, ' '],
	[/\b[\w.@+-]+(?:[\\/][\w.@+-]+)+\b/g, ' '],
	[/\b[0-9a-f]{7,64}\b/giu, ' '],
	[/--?[a-z][\w-]*/giu, ' '],
	[/\b[A-Z][A-Z0-9_-]{1,}\b/g, normalizeUppercaseToken],
	[CODE_IDENTIFIER, ' '],
	[/[\p{P}\p{S}]+/gu, ' ']
];

export function normalizeTechnicalSyntax(text: string): string {
	let normalized = text.normalize('NFKC');
	for (const [pattern, replacement] of TECHNICAL_SYNTAX) {
		normalized =
			typeof replacement === 'string'
				? normalized.replace(pattern, replacement)
				: normalized.replace(pattern, replacement);
	}
	return normalized.replace(/\s+/g, ' ').trim();
}

// NFKC never composes across whitespace, so normalizing each whitespace-separated
// chunk matches normalizing the whole text. A chunk that NFKC changes maps to its start.
function normalizeWithOffsets(text: string): TrackedText {
	let normalized = '';
	const offsets: number[] = [];
	for (const chunk of text.matchAll(/\s|\S+/gu)) {
		const value = chunk[0].normalize('NFKC');
		const unchanged = value === chunk[0];
		for (let index = 0; index < value.length; index++) {
			offsets.push(chunk.index + (unchanged ? index : 0));
		}
		normalized += value;
	}
	return { text: normalized, offsets };
}

function replaceWithOffsets(
	source: TrackedText,
	pattern: RegExp,
	replacement: TechnicalReplacement
): TrackedText {
	const matches = pattern.global
		? [...source.text.matchAll(pattern)]
		: [source.text.match(pattern)].filter((match) => match !== null);
	if (matches.length === 0) return source;
	let text = '';
	const offsets: number[] = [];
	let cursor = 0;
	const keep = (end: number): void => {
		text += source.text.slice(cursor, end);
		for (let index = cursor; index < end; index++) offsets.push(source.offsets[index]!);
	};

	for (const match of matches) {
		const start = match.index ?? 0;
		keep(start);
		const value = typeof replacement === 'string' ? replacement : replacement(match[0]);
		text += value;
		for (let index = 0; index < value.length; index++) offsets.push(source.offsets[start]!);
		cursor = start + match[0].length;
	}
	keep(source.text.length);
	return { text, offsets };
}

/** Words that survive technical-syntax normalization, with their offsets in `text`. */
function retainedWords(text: string): SourceWord[] {
	let tracked = normalizeWithOffsets(text);
	for (const [pattern, replacement] of TECHNICAL_SYNTAX) {
		tracked = replaceWithOffsets(tracked, pattern, replacement);
	}
	return [...tracked.text.matchAll(WORD)].map((match) => ({
		text: match[0],
		offset: tracked.offsets[match.index]!
	}));
}

export function finiteLanguageScores(scores: Record<string, number>): LanguageScore[] {
	return Object.entries(scores)
		.filter((entry): entry is [string, number] => Number.isFinite(entry[1]))
		.map(([language, score]) => ({ language, score }))
		.sort((left, right) => right.score - left.score || left.language.localeCompare(right.language));
}

export function classifyEnglish(
	text: string,
	languageDetector: LanguageDetector = detector
): EnglishClassification {
	const normalizedText = normalizeTechnicalSyntax(text);
	if (normalizedText === '') {
		return { outcome: 'insufficient-evidence', reason: 'empty', normalizedText };
	}
	if (isShortTechnicalEnglish(normalizedText)) {
		return { outcome: 'accepted', reason: 'technical-english', normalizedText };
	}

	const tokens = words(normalizedText);
	const letterCharacters = normalizedText.match(/\p{L}/gu) ?? [];
	const letters = letterCharacters.length;
	const nonAsciiLetters = letterCharacters.filter(
		(character) => (character.codePointAt(0) ?? 0) > 0x7f
	).length;
	const nonLatinLetters = letterCharacters.filter(
		(character) => !/\p{Script=Latin}/u.test(character)
	).length;

	const singleLongWord = tokens.length === 1 && letters >= 10;
	if ((tokens.length < 2 || letters < 8) && nonLatinLetters < 3 && !singleLongWord) {
		return { outcome: 'insufficient-evidence', reason: 'short', normalizedText };
	}

	const scores = finiteLanguageScores(languageDetector.detect(normalizedText).getScores());
	const [top] = scores;
	if (!top) {
		return { outcome: 'insufficient-evidence', reason: 'ambiguous-score', normalizedText };
	}
	if (top.language === 'en') {
		return { outcome: 'accepted', reason: 'english-score', normalizedText };
	}

	const english = scores.find((score) => score.language === 'en');
	const englishScore = english?.score ?? null;
	const margin = top.score - (englishScore ?? 0);
	const shortAsciiProse = nonAsciiLetters === 0 && tokens.length < 5;
	const uppercaseProse = tokens.every(
		(token) => token === token.toUpperCase() && token !== token.toLowerCase()
	);
	const enoughText =
		nonLatinLetters >= 3 ||
		(nonAsciiLetters > 0 && tokens.length >= 2) ||
		(tokens.length >= 5 && letters >= 20) ||
		(shortAsciiProse && tokens.length >= 2 && letters >= 8) ||
		singleLongWord;
	const scoreThreshold = singleLongWord
		? 0.78
		: nonLatinLetters >= 3
			? 0.55
			: shortAsciiProse
				? uppercaseProse
					? 0.65
					: 0.77
				: 0.72;
	const marginThreshold = singleLongWord
		? 0.35
		: shortAsciiProse
			? uppercaseProse
				? 0.25
				: 0.3
			: 0.12;

	if (enoughText && top.score >= scoreThreshold && margin >= marginThreshold) {
		return {
			outcome: 'violation',
			language: top.language,
			topScore: top.score,
			englishScore,
			normalizedText
		};
	}

	return { outcome: 'insufficient-evidence', reason: 'ambiguous-score', normalizedText };
}

function lineLocator(text: string, startLine: number): (offset: number) => number {
	const breaks = [...text.matchAll(/\n/g)].map((match) => match.index);
	return (offset) => {
		let low = 0;
		let high = breaks.length;
		while (low < high) {
			const middle = (low + high) >> 1;
			if (breaks[middle]! < offset) low = middle + 1;
			else high = middle;
		}
		return startLine + low;
	};
}

function sentenceWindows(text: string, startLine: number): TextWindow[] {
	const windows: TextWindow[] = [];
	const lineAt = lineLocator(text, startLine);
	let sentenceStart = 0;

	const addSentence = (end: number): void => {
		const rawSentence = text.slice(sentenceStart, end);
		const leadingWhitespace = rawSentence.match(/^\s*/u)?.[0].length ?? 0;
		const sentence = rawSentence.trim();
		const offset = sentenceStart + leadingWhitespace;
		sentenceStart = end;
		if (sentence === '') return;
		const sentenceWords = retainedWords(sentence);
		// A window belongs to the line of its first retained word, not the sentence start.
		const lineOf = (wordIndex: number): number =>
			lineAt(offset + (sentenceWords[wordIndex]?.offset ?? 0));
		const windowText = (from: number): string =>
			sentenceWords
				.slice(from, from + 8)
				.map((word) => word.text)
				.join(' ');
		windows.push({ text: sentence, line: lineOf(0) });
		if (sentenceWords.length < 8) return;

		for (let wordOffset = 0; wordOffset + 4 <= sentenceWords.length; wordOffset += 4) {
			const window = windowText(wordOffset);
			if (window !== sentence) windows.push({ text: window, line: lineOf(wordOffset) });
		}
		const tailStart = sentenceWords.length - 8;
		const tail = windowText(tailStart);
		if (tail !== windows.at(-1)?.text && tail !== sentence) {
			windows.push({ text: tail, line: lineOf(tailStart) });
		}
	};

	for (const boundary of text.matchAll(/[.!?。！？]+(?=\s|$)/gu)) {
		addSentence((boundary.index ?? 0) + boundary[0].length);
	}
	addSentence(text.length);
	return windows;
}

export function splitTextWindows(text: string, startLine = 1): TextWindow[] {
	const normalized = text.replace(/\r\n?/g, '\n');
	const windows: TextWindow[] = [];
	const lineAt = lineLocator(normalized, startLine);
	const paragraphPattern = /\S(?:[\s\S]*?\S)?(?=\n\s*\n|$)/g;
	for (const match of normalized.matchAll(paragraphPattern)) {
		const paragraph = match[0].trim();
		if (paragraph === '') continue;
		const line = lineAt(match.index ?? 0);
		windows.push(...sentenceWindows(paragraph, line));
	}
	return windows;
}
