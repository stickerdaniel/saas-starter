import * as ts from 'typescript';
import { SUPPORTED_LANGUAGE_CODES } from '../../src/lib/i18n/language-codes.generated.js';
import { classifyEnglish, splitTextWindows, type TextWindow } from './classifier';

export interface EnglishFinding {
	label: string;
	line: number;
	language: string;
	topScore: number;
	englishScore: number | null;
}

export type ProseKind = 'markdown' | 'text' | 'source' | 'json' | 'english-locale';

const TARGET_LOCALE_FILES = new Set(
	SUPPORTED_LANGUAGE_CODES.filter((code) => code !== 'en').map((code) => `src/i18n/${code}.json`)
);
const LOCALE_LABELS = new Set(SUPPORTED_LANGUAGE_CODES.filter((code) => code !== 'en'));

function localeLabelledQuotation(line: string): boolean {
	const match = line.match(
		/^\s*(?:[-*]\s+)?(?:\*\*)?([a-z]{2}(?:-[A-Z]{2})?)(?:\*\*)?\s*:\s*(?:"[^"\n]+"|'[^'\n]+'|“[^”\n]+”)\s*$/u
	);
	return match !== null && LOCALE_LABELS.has(match[1]!);
}

function markdownBlocks(text: string): TextWindow[] {
	const lines = text.replace(/\r\n?/g, '\n').split('\n');
	const blocks: TextWindow[] = [];
	let block: string[] = [];
	let blockLine = 1;
	let fence: string | null = null;

	const flush = (): void => {
		if (block.length === 0) return;
		blocks.push(...splitTextWindows(block.join('\n'), blockLine));
		block = [];
	};

	for (let index = 0; index < lines.length; index++) {
		const raw = lines[index]!;
		const fenceMatch = raw.match(/^\s*(```+|~~~+)/);
		if (fenceMatch) {
			flush();
			if (fence === null) fence = fenceMatch[1]![0]!;
			else if (fenceMatch[1]!.startsWith(fence)) fence = null;
			continue;
		}
		if (fence !== null) continue;
		if (localeLabelledQuotation(raw)) {
			flush();
			continue;
		}

		const cleaned = raw
			.replace(/<!--|-->/g, ' ')
			.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
			.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
			.replace(/<[^>]+>/g, ' ')
			.replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, '')
			.trim();
		if (cleaned === '') {
			flush();
			continue;
		}
		if (block.length === 0) blockLine = index + 1;
		block.push(cleaned);
	}
	flush();
	return blocks;
}

function cleanComment(comment: string): string {
	return comment
		.replace(/^\/\//, '')
		.replace(/^\/\*/, '')
		.replace(/\*\/$/, '')
		.split('\n')
		.map((line) => line.replace(/^\s*\*?\s?/, ''))
		.join('\n')
		.trim();
}

function sourceComments(text: string, svelte: boolean): TextWindow[] {
	const comments: TextWindow[] = [];
	const scanner = ts.createScanner(
		ts.ScriptTarget.Latest,
		false,
		svelte ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard,
		text
	);
	for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
		if (
			token !== ts.SyntaxKind.SingleLineCommentTrivia &&
			token !== ts.SyntaxKind.MultiLineCommentTrivia
		)
			continue;
		const comment = cleanComment(scanner.getTokenText());
		if (comment === '') continue;
		const line = text.slice(0, scanner.getTokenPos()).split('\n').length;
		comments.push(...splitTextWindows(comment, line));
	}
	if (svelte) {
		for (const match of text.matchAll(/<!--([\s\S]*?)-->/g)) {
			const comment = match[1]!.trim();
			if (comment === '') continue;
			const line = text.slice(0, match.index ?? 0).split('\n').length;
			comments.push(...splitTextWindows(comment, line));
		}
	}
	return comments;
}

function propertyName(node: ts.PropertyName): string | null {
	if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text;
	return null;
}

function jsonStrings(text: string, label: string, allLeaves: boolean): TextWindow[] {
	const source = ts.parseJsonText(label, text);
	if (source.parseDiagnostics.length > 0) {
		throw new Error(`Cannot parse ${label} as JSON/JSONC.`);
	}
	const statement = source.statements[0];
	if (!statement || !ts.isExpressionStatement(statement)) return [];
	const strings: TextWindow[] = [];

	const add = (node: ts.StringLiteralLike): void => {
		const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
		strings.push(...splitTextWindows(node.text, line));
	};
	const visitValue = (node: ts.Expression): void => {
		if (ts.isStringLiteralLike(node)) {
			if (allLeaves) add(node);
			return;
		}
		if (ts.isArrayLiteralExpression(node)) {
			for (const element of node.elements) {
				if (ts.isExpression(element)) visitValue(element);
			}
			return;
		}
		if (!ts.isObjectLiteralExpression(node)) return;
		for (const property of node.properties) {
			if (!ts.isPropertyAssignment(property)) continue;
			const name = propertyName(property.name);
			if (name === 'description' && ts.isStringLiteralLike(property.initializer)) {
				add(property.initializer);
				continue;
			}
			visitValue(property.initializer);
		}
	};
	visitValue(statement.expression);
	return strings;
}

export function isEnglishPolicyFile(file: string): boolean {
	if (TARGET_LOCALE_FILES.has(file)) return false;
	if (file === 'src/i18n/en.json') return true;
	return /\.(?:md|markdown|txt|js|ts|svelte|json|jsonc)$/i.test(file);
}

export function proseKindForFile(file: string): ProseKind | null {
	if (!isEnglishPolicyFile(file)) return null;
	if (file === 'src/i18n/en.json') return 'english-locale';
	if (/\.(?:md|markdown)$/i.test(file)) return 'markdown';
	if (/\.txt$/i.test(file)) return 'text';
	if (/\.(?:js|ts|svelte)$/i.test(file)) return 'source';
	if (/\.(?:json|jsonc)$/i.test(file)) return 'json';
	return null;
}

export function proseWindows(file: string, text: string, forcedKind?: ProseKind): TextWindow[] {
	const kind = forcedKind ?? proseKindForFile(file);
	if (kind === null) return [];
	if (kind === 'markdown') return markdownBlocks(text);
	if (kind === 'text') return splitTextWindows(text);
	if (kind === 'source') return sourceComments(text, file.endsWith('.svelte'));
	return jsonStrings(text, file, kind === 'english-locale');
}

export function checkEnglishText(
	label: string,
	text: string,
	forcedKind?: ProseKind
): EnglishFinding[] {
	const findings: EnglishFinding[] = [];
	for (const window of proseWindows(label, text, forcedKind)) {
		const classification = classifyEnglish(window.text);
		if (classification.outcome !== 'violation') continue;
		findings.push({
			label,
			line: window.line,
			language: classification.language,
			topScore: classification.topScore,
			englishScore: classification.englishScore
		});
	}
	return findings;
}

export function formatEnglishFinding(finding: EnglishFinding): string {
	const english = finding.englishScore === null ? 'unavailable' : finding.englishScore.toFixed(3);
	return `${finding.label}:${finding.line}: clear non-English prose (${finding.language}; top score ${finding.topScore.toFixed(3)}; English score ${english})`;
}
