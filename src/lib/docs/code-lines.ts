import type { HighlightTokenClass } from '@tanstack/highlight';

/** One coloured run of a code line; `className` names the highlight theme's colour. */
export interface CodeToken {
	value: string;
	className?: HighlightTokenClass;
}

/** The highlighted lines of each fence of a page, keyed by `codeKey`. */
export type PageCode = Readonly<Record<string, CodeToken[][]>>;

/** A fence's code as every reader of it sees it: its trailing blank lines dropped. */
export const fenceCode = (text: string) => text.replace(/\n+$/, '');

export const codeKey = (lang: string | undefined, code: string) => `${lang ?? ''}\n${code}`;
