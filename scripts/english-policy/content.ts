import { parse as parseSvelte } from 'svelte/compiler';
import svelteParser from 'svelte-eslint-parser';
import * as ts from 'typescript';
import tseslint from 'typescript-eslint';
import { SUPPORTED_LANGUAGE_CODES } from '../../src/lib/i18n/language-codes.generated.js';
import { classifyEnglish, splitTextWindows, type TextWindow } from './classifier';
import { withoutMarkdownCode } from './markdown';

export interface EnglishFinding {
	label: string;
	line: number;
	language: string;
	topScore: number;
	englishScore: number | null;
}

export type ProseKind = 'markdown' | 'text' | 'source' | 'json' | 'english-locale';

interface SourceComment {
	kind: 'line' | 'block';
	start: number;
	end: number;
}

const GENERATED_PR_METADATA_BUNDLE = 'scripts/english-policy/pr-metadata.bundle.mjs';
const TARGET_LOCALE_FILES = new Set(
	SUPPORTED_LANGUAGE_CODES.filter((code) => code !== 'en').map((code) => `src/i18n/${code}.json`)
);
const LOCALE_LABELS = new Set(SUPPORTED_LANGUAGE_CODES.filter((code) => code !== 'en'));

export function normalizePolicyIdentity(file: string): string {
	return file.replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function localeLabelledQuotation(line: string): boolean {
	const match = line.match(
		/^\s*(?:[-*]\s+)?(?:\*\*)?([a-z]{2}(?:-[A-Z]{2})?)(?:\*\*)?\s*:\s*(?:"[^"\n]+"|'[^'\n]+'|“[^”\n]+”)\s*$/u
	);
	return match !== null && LOCALE_LABELS.has(match[1]!);
}

function markdownBlocks(text: string): TextWindow[] {
	const lines = withoutMarkdownCode(text).split('\n');
	const blocks: TextWindow[] = [];
	let block: string[] = [];
	let blockLine = 1;

	const flush = (): void => {
		if (block.length === 0) return;
		blocks.push(...splitTextWindows(block.join('\n'), blockLine));
		block = [];
	};

	for (let index = 0; index < lines.length; index++) {
		const raw = lines[index]!;
		const tableRow = /^\s*\|/u.test(raw);
		if (tableRow) flush();
		if (localeLabelledQuotation(raw)) {
			flush();
			continue;
		}

		const cleaned = raw
			.replace(/<!--|-->/g, ' ')
			.replace(/`[^`\r\n]+`/g, ' ')
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
		if (tableRow) flush();
	}
	flush();
	return blocks;
}

function cleanComment(comment: string): string {
	return comment
		.replace(/^\/\//, '')
		.replace(/^\/\*/, '')
		.replace(/\*\/$/, '')
		.replace(/^<!--/, '')
		.replace(/-->$/, '')
		.split('\n')
		.map((line) => line.replace(/^\s*\*?\s?/, ''))
		.join('\n')
		.trim();
}

function lineAtOffset(text: string, offset: number): number {
	return (text.slice(0, offset).match(/\n/g)?.length ?? 0) + 1;
}

function addCommentRange(
	comments: Map<string, SourceComment>,
	kind: SourceComment['kind'],
	start: number,
	end: number
): void {
	if (start < 0 || end <= start) return;
	comments.set(`${start}:${end}`, { kind, start, end });
}

function addTypeScriptCommentRanges(
	comments: Map<string, SourceComment>,
	text: string,
	position: number,
	trailing: boolean
): void {
	const ranges = trailing
		? ts.getTrailingCommentRanges(text, position)
		: ts.getLeadingCommentRanges(text, position);
	for (const range of ranges ?? []) {
		addCommentRange(
			comments,
			range.kind === ts.SyntaxKind.SingleLineCommentTrivia ? 'line' : 'block',
			range.pos,
			range.end
		);
	}
}

function scriptKind(file: string): ts.ScriptKind {
	const extension = normalizePolicyIdentity(file).toLowerCase();
	if (extension.endsWith('.jsx')) return ts.ScriptKind.JSX;
	if (extension.endsWith('.tsx')) return ts.ScriptKind.TSX;
	if (extension.endsWith('.js') || extension.endsWith('.mjs') || extension.endsWith('.cjs')) {
		return ts.ScriptKind.JS;
	}
	return ts.ScriptKind.TS;
}

function typeScriptComments(file: string, text: string): SourceComment[] {
	const comments = new Map<string, SourceComment>();
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, scriptKind(file));

	const visit = (node: ts.Node): void => {
		addTypeScriptCommentRanges(comments, text, node.getFullStart(), false);
		addTypeScriptCommentRanges(comments, text, node.getEnd(), true);
		for (const child of node.getChildren(source)) visit(child);
	};
	visit(source);
	return [...comments.values()];
}

function markupComments(value: unknown, comments: Map<string, SourceComment>): void {
	if (Array.isArray(value)) {
		for (const item of value) markupComments(item, comments);
		return;
	}
	if (typeof value !== 'object' || value === null) return;
	const node = value as Record<string, unknown>;
	if (node.type === 'Comment' && typeof node.start === 'number' && typeof node.end === 'number') {
		addCommentRange(comments, 'block', node.start, node.end);
		return;
	}
	for (const child of Object.values(node)) markupComments(child, comments);
}

function svelteComments(file: string, text: string): SourceComment[] {
	const comments = new Map<string, SourceComment>();
	const root = parseSvelte(text, { filename: file, modern: true });
	for (const comment of root.comments) {
		addCommentRange(
			comments,
			comment.type === 'Line' ? 'line' : 'block',
			comment.start,
			comment.end
		);
	}
	markupComments(root.fragment, comments);

	const parsed = svelteParser.parseForESLint(text, {
		comment: true,
		filePath: file,
		loc: true,
		parser: tseslint.parser,
		range: true,
		tokens: true
	});
	const styleContext = parsed.services.getStyleContext();
	if (styleContext.status === 'success') {
		styleContext.sourceAst.walkComments((comment) => {
			const [start, end] = parsed.services.styleNodeRange(comment);
			if (start !== undefined && end !== undefined) addCommentRange(comments, 'block', start, end);
		});
	}
	return [...comments.values()];
}

function sourceCommentWindows(file: string, text: string): TextWindow[] {
	const ranges = (
		file.toLowerCase().endsWith('.svelte')
			? svelteComments(file, text)
			: typeScriptComments(file, text)
	).sort((left, right) => left.start - right.start || left.end - right.end);
	const windows: TextWindow[] = [];
	let lineGroup: SourceComment[] = [];

	const flushLineGroup = (): void => {
		if (lineGroup.length === 0) return;
		const comment = lineGroup
			.map((range) => cleanComment(text.slice(range.start, range.end)))
			.join(' ');
		if (comment !== '') {
			windows.push(...splitTextWindows(comment, lineAtOffset(text, lineGroup[0]!.start)));
		}
		lineGroup = [];
	};

	for (const range of ranges) {
		if (range.kind === 'block') {
			flushLineGroup();
			const comment = cleanComment(text.slice(range.start, range.end));
			if (comment !== '')
				windows.push(...splitTextWindows(comment, lineAtOffset(text, range.start)));
			continue;
		}

		const previous = lineGroup.at(-1);
		if (
			previous !== undefined &&
			!/^[ \t]*\r?\n[ \t]*$/u.test(text.slice(previous.end, range.start))
		) {
			flushLineGroup();
		}
		lineGroup.push(range);
	}
	flushLineGroup();
	return windows;
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

export function isJavaScriptSourceFile(file: string): boolean {
	return /\.(?:[cm]?[jt]s|[jt]sx|svelte)$/iu.test(normalizePolicyIdentity(file));
}

export function isEnglishPolicyFile(file: string): boolean {
	const identity = normalizePolicyIdentity(file);
	if (identity === GENERATED_PR_METADATA_BUNDLE || TARGET_LOCALE_FILES.has(identity)) return false;
	if (identity === 'src/i18n/en.json') return true;
	return /\.(?:md|markdown|txt|json|jsonc)$/iu.test(identity) || isJavaScriptSourceFile(identity);
}

export function proseKindForFile(file: string): ProseKind | null {
	const identity = normalizePolicyIdentity(file);
	if (!isEnglishPolicyFile(identity)) return null;
	if (identity === 'src/i18n/en.json') return 'english-locale';
	if (/\.(?:md|markdown)$/iu.test(identity)) return 'markdown';
	if (/\.txt$/iu.test(identity)) return 'text';
	if (isJavaScriptSourceFile(identity)) return 'source';
	if (/\.(?:json|jsonc)$/iu.test(identity)) return 'json';
	return null;
}

export function proseWindows(file: string, text: string, forcedKind?: ProseKind): TextWindow[] {
	const kind = forcedKind ?? proseKindForFile(file);
	if (kind === null) return [];
	if (kind === 'markdown') return markdownBlocks(text);
	if (kind === 'text') return splitTextWindows(text);
	if (kind === 'source') return sourceCommentWindows(file, text);
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
