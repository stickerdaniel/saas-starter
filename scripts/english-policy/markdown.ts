interface Fence {
	marker: '`' | '~';
	length: number;
}

function fenceMarker(line: string): string | null {
	return line.match(/^\s{0,3}(`{3,}|~{3,})/u)?.[1] ?? null;
}

export function withoutMarkdownCode(text: string): string {
	const kept: string[] = [];
	let fence: Fence | null = null;
	let indentedCode = false;
	let previousLineWasBlank = true;

	for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
		const marker = fenceMarker(line);
		if (fence !== null) {
			const closesFence =
				marker !== null &&
				marker[0] === fence.marker &&
				marker.length >= fence.length &&
				line.slice(line.indexOf(marker) + marker.length).trim() === '';
			if (closesFence) fence = null;
			kept.push('');
			previousLineWasBlank = true;
			continue;
		}
		if (marker !== null) {
			fence = { marker: marker[0] as Fence['marker'], length: marker.length };
			kept.push('');
			previousLineWasBlank = true;
			continue;
		}

		const blank = line.trim() === '';
		const hasCodeIndent = /^(?: {4}|\t)/u.test(line);
		if (indentedCode) {
			if (blank || hasCodeIndent) {
				kept.push('');
				previousLineWasBlank = true;
				continue;
			}
			indentedCode = false;
		}
		if (previousLineWasBlank && hasCodeIndent) {
			indentedCode = true;
			kept.push('');
			previousLineWasBlank = true;
			continue;
		}

		kept.push(line);
		previousLineWasBlank = blank;
	}

	return kept.join('\n');
}
