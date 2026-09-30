import postcss from 'postcss';

export function sanitizeEmailCss(css: string): string {
	return css.replace(/cursor\s*:\s*url\([^;]+;/g, '');
}

/** Keep dark declarations nested so Outlook retains its own colour inversion. */
export function nestEmailDarkRules(css: string): string {
	const root = postcss.parse(css);
	root.walkAtRules('media', (media) => {
		if (media.params.replace(/\s/g, '').toLowerCase() !== '(prefers-color-scheme:dark)') return;
		if (media.parent?.type === 'rule' || !media.nodes) return;
		if (!media.nodes.some((child) => child.type === 'rule')) return;
		// Replace the block in source order, retaining any outer conditions. Other
		// children stay in their own dark blocks so the cascade order is unchanged.
		let darkBlock: postcss.AtRule | undefined;
		for (const child of media.nodes) {
			if (child.type === 'rule') {
				darkBlock = undefined;
				const nestedMedia = postcss.atRule({ name: 'media', params: media.params });
				nestedMedia.append(child.nodes.map((node) => node.clone()));
				media.before(postcss.rule({ selector: child.selector }).append(nestedMedia));
				continue;
			}
			if (!darkBlock) {
				darkBlock = postcss.atRule({ name: 'media', params: media.params });
				media.before(darkBlock);
			}
			darkBlock.append(child.clone());
		}
		media.remove();
	});
	return root.toString();
}

/** Apply {@link nestEmailDarkRules} to every `<style>` block of a rendered email. */
export function nestEmailDarkStyles(html: string): string {
	return html.replace(
		/(<style\b(?:[^>"']|"[^"]*"|'[^']*')*>)([\s\S]*?)(<\/style>)/gi,
		(_match, start: string, css: string, end: string) => `${start}${nestEmailDarkRules(css)}${end}`
	);
}
