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
const SHORT_TECHNICAL_WORDS = new Set([
	'add',
	'allow',
	'api',
	'auth',
	'build',
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
	'set',
	'skip',
	'support',
	'test',
	'token',
	'update',
	'use',
	'validate'
]);

function words(text: string): string[] {
	return text.match(/\p{L}[\p{L}\p{M}'’-]*/gu) ?? [];
}

function isShortTechnicalEnglish(text: string): boolean {
	const withoutPrefix = text.replace(CONVENTIONAL_COMMIT, '').trim();
	const tokens = words(withoutPrefix);
	return (
		tokens.length > 0 &&
		tokens.length <= 4 &&
		tokens.every((token) =>
			/^[A-Z][A-Z0-9]*$/.test(token) ? true : SHORT_TECHNICAL_WORDS.has(token.toLowerCase())
		)
	);
}

export function normalizeTechnicalSyntax(text: string): string {
	return text
		.normalize('NFKC')
		.replace(CONVENTIONAL_COMMIT, '')
		.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, ' ')
		.replace(/`[^`\r\n]+`/g, ' ')
		.replace(/https?:\/\/\S+|www\.\S+/giu, ' ')
		.replace(/@[\w.-]+\/[\w.-]+/g, ' ')
		.replace(/(?:[A-Za-z]:[\\/]|\.{0,2}[\\/])(?:[^\s<>"'`]+[\\/])*[^\s<>"'`]*/g, ' ')
		.replace(/\b[\w.@+-]+(?:[\\/][\w.@+-]+)+\b/g, ' ')
		.replace(/\b[0-9a-f]{7,64}\b/giu, ' ')
		.replace(/--?[a-z][\w-]*/giu, ' ')
		.replace(/\b[A-Z][A-Z0-9_-]{1,}\b/g, ' ')
		.replace(/\b(?:[$_][\w$]*|[a-z]+(?:[A-Z][\w$]*)+)\b/g, ' ')
		.replace(/[\p{P}\p{S}]+/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();
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
	if (isShortTechnicalEnglish(text)) {
		return { outcome: 'accepted', reason: 'technical-english', normalizedText };
	}

	const tokens = words(normalizedText);
	const letterCharacters = normalizedText.match(/\p{L}/gu) ?? [];
	const letters = letterCharacters.length;
	const nonAsciiLetters = letterCharacters.filter(
		(character) => (character.codePointAt(0) ?? 0) > 0x7f
	).length;
	const nonLatinLetters =
		normalizedText.match(
			/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Devanagari}]/gu
		)?.length ?? 0;

	if ((tokens.length < 2 || letters < 8) && nonLatinLetters < 3) {
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
	const enoughText =
		nonLatinLetters >= 3 ||
		(nonAsciiLetters > 0 && tokens.length >= 2) ||
		(tokens.length >= 5 && letters >= 20);
	const scoreThreshold = nonLatinLetters >= 3 ? 0.55 : 0.72;

	if (enoughText && top.score >= scoreThreshold && margin >= 0.12) {
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

function lineAt(text: string, offset: number, startLine: number): number {
	return startLine + (text.slice(0, offset).match(/\n/g)?.length ?? 0);
}

function sentenceWindows(text: string, startLine: number): TextWindow[] {
	const windows: TextWindow[] = [];
	const sentencePattern = /[^.!?。！？\n]+(?:[.!?。！？]+|$)/gu;
	for (const match of text.matchAll(sentencePattern)) {
		const sentence = match[0].trim();
		if (sentence === '') continue;
		const line = lineAt(text, match.index ?? 0, startLine);
		const sentenceWords = words(sentence);
		if (sentenceWords.length <= 24) {
			windows.push({ text: sentence, line });
			continue;
		}
		for (let offset = 0; offset < sentenceWords.length; offset += 12) {
			const window = sentenceWords.slice(offset, offset + 16);
			if (window.length < 4 && offset > 0) break;
			windows.push({ text: window.join(' '), line });
		}
		const tail = sentenceWords.slice(-16).join(' ');
		if (tail !== windows.at(-1)?.text) windows.push({ text: tail, line });
	}
	return windows;
}

export function splitTextWindows(text: string, startLine = 1): TextWindow[] {
	const normalized = text.replace(/\r\n?/g, '\n');
	const windows: TextWindow[] = [];
	const paragraphPattern = /\S(?:[\s\S]*?\S)?(?=\n\s*\n|$)/g;
	for (const match of normalized.matchAll(paragraphPattern)) {
		const paragraph = match[0].trim();
		if (paragraph === '') continue;
		const line = lineAt(normalized, match.index ?? 0, startLine);
		windows.push(...sentenceWindows(paragraph, line));
	}
	return windows;
}
