/**
 * Pure helpers for the in-app text/markdown/code attachment preview.
 *
 * Kept separate from the Svelte component so the detection, fencing and
 * truncation logic can be unit-tested without a DOM.
 */

/** Max characters of attachment text the client renders in the preview. */
export const MAX_PREVIEW_TEXT_CHARS = 256 * 1024;

/**
 * File extension -> Shiki language id for code-style previews. Extensions not
 * listed fall back to plain text. CSV has no dedicated Shiki grammar, so it is
 * shown as plain monospaced text rather than highlighted.
 */
export const EXT_TO_SHIKI_LANG: Readonly<Record<string, string>> = {
	'.json': 'json',
	'.js': 'javascript',
	'.mjs': 'javascript',
	'.cjs': 'javascript',
	'.ts': 'typescript',
	'.tsx': 'tsx',
	'.jsx': 'jsx',
	'.css': 'css',
	'.html': 'html',
	'.htm': 'html',
	'.xml': 'xml',
	'.svg': 'xml',
	'.yaml': 'yaml',
	'.yml': 'yaml',
	'.toml': 'toml',
	'.sh': 'bash',
	'.bash': 'bash',
	'.zsh': 'bash',
	'.py': 'python',
	'.sql': 'sql',
	'.csv': 'text'
};

export type PreviewKind =
	| { kind: 'markdown' }
	| { kind: 'plaintext' }
	| { kind: 'code'; lang: string };

/** Lowercased file extension including the dot, or null. */
export function getExtension(filename: string | undefined): string | null {
	if (!filename) return null;
	const dot = filename.lastIndexOf('.');
	if (dot < 0) return null;
	return filename.slice(dot).toLowerCase();
}

/** MIME essence (drops any `; charset=...` parameter), lowercased. */
function mimeEssence(mimeType: string | undefined): string {
	return (mimeType ?? '').split(';')[0]!.trim().toLowerCase();
}

/**
 * Decide how to render a text attachment from its MIME type and filename.
 * Extension wins over MIME because a stored text file's served MIME is often
 * generic, and structured types map to highlighted code.
 */
export function getPreviewKind(
	mimeType: string | undefined,
	filename: string | undefined
): PreviewKind {
	const ext = getExtension(filename);
	const mime = mimeEssence(mimeType);

	if (ext === '.md' || ext === '.markdown' || mime === 'text/markdown') {
		return { kind: 'markdown' };
	}
	if (ext && ext in EXT_TO_SHIKI_LANG) {
		const lang = EXT_TO_SHIKI_LANG[ext]!;
		return lang === 'text' ? { kind: 'plaintext' } : { kind: 'code', lang };
	}
	if (mime === 'application/json') return { kind: 'code', lang: 'json' };
	if (mime === 'application/xml' || mime === 'text/xml') return { kind: 'code', lang: 'xml' };
	// .txt, text/plain and any other text-like content render as plain text.
	return { kind: 'plaintext' };
}

/**
 * Whether an attachment should render in the rich text preview (markdown /
 * plain text / highlighted code) rather than the raw <iframe>. PDFs and other
 * browser-native or binary types return false and keep the iframe.
 */
export function isTextPreviewable(
	mimeType: string | undefined,
	filename: string | undefined
): boolean {
	const mime = mimeEssence(mimeType);
	if (mime.startsWith('text/')) return true;
	if (mime === 'application/json' || mime === 'application/xml') return true;
	const ext = getExtension(filename);
	if (ext === '.md' || ext === '.markdown' || ext === '.txt') return true;
	return !!ext && ext in EXT_TO_SHIKI_LANG;
}

/** Longest run of consecutive backticks in the text (0 if none). */
export function longestBacktickRun(text: string): number {
	const runs = text.match(/`+/g);
	if (!runs) return 0;
	return runs.reduce((max, run) => Math.max(max, run.length), 0);
}

/**
 * Wrap raw file content in a fenced code block for Streamdown. The fence is one
 * backtick longer than the longest backtick run in the content (min 3), so
 * content containing ``` cannot break out of the fence and have its remainder
 * re-parsed as Markdown.
 */
export function buildCodeMarkdown(text: string, lang: string): string {
	const fence = '`'.repeat(Math.max(3, longestBacktickRun(text) + 1));
	return `${fence}${lang}\n${text}\n${fence}`;
}

/** Cap text to MAX_PREVIEW_TEXT_CHARS, reporting whether it was truncated. */
export function capPreviewText(text: string): { text: string; truncated: boolean } {
	if (text.length > MAX_PREVIEW_TEXT_CHARS) {
		return { text: text.slice(0, MAX_PREVIEW_TEXT_CHARS), truncated: true };
	}
	return { text, truncated: false };
}
