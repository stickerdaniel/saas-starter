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
		// Move each selector in place, retaining source order and any outer conditions.
		for (const child of [...media.nodes]) {
			if (child.type !== 'rule') continue;
			const selector = postcss.rule({ selector: child.selector });
			const nestedMedia = postcss.atRule({ name: 'media', params: media.params });
			nestedMedia.append(child.nodes.map((node) => node.clone()));
			selector.append(nestedMedia);
			media.parent!.insertBefore(media, selector);
			child.remove();
		}
		if (media.nodes.length === 0) media.remove();
	});
	return root.toString();
}
