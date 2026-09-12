export function sanitizeEmailCss(css: string): string {
	return css.replace(/cursor\s*:\s*url\([^;]+;/g, '');
}
