interface Fence {
	marker: '`' | '~';
	length: number;
}

function fenceMarker(line: string): string | null {
	return line.match(/^\s{0,3}(`{3,}|~{3,})/u)?.[1] ?? null;
}

export function withoutFencedCode(text: string): string {
	const kept: string[] = [];
	let fence: Fence | null = null;

	for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
		const marker = fenceMarker(line);
		if (fence === null) {
			if (marker !== null) {
				fence = { marker: marker[0] as Fence['marker'], length: marker.length };
				kept.push('');
				continue;
			}
			kept.push(line);
			continue;
		}

		const closesFence =
			marker !== null &&
			marker[0] === fence.marker &&
			marker.length >= fence.length &&
			line.slice(line.indexOf(marker) + marker.length).trim() === '';
		if (closesFence) fence = null;
		kept.push('');
	}

	return kept.join('\n');
}
