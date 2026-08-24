function splitMediaRanges(value: string): string[] {
	const ranges: string[] = [];
	let start = 0;
	let quoted = false;
	let escaped = false;

	for (let index = 0; index < value.length; index += 1) {
		const character = value[index]!;
		if (escaped) {
			escaped = false;
			continue;
		}
		if (character === '\\' && quoted) {
			escaped = true;
			continue;
		}
		if (character === '"') {
			quoted = !quoted;
			continue;
		}
		if (character === ',' && !quoted) {
			ranges.push(value.slice(start, index));
			start = index + 1;
		}
	}
	ranges.push(value.slice(start));
	return ranges;
}

function qualityValue(parameters: string[]): number {
	for (const parameter of parameters) {
		const [rawName, ...rawValue] = parameter.split('=');
		if (rawName?.trim().toLowerCase() !== 'q') continue;
		const value = rawValue.join('=').trim();
		if (!/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(value)) return 0;
		return Number(value);
	}
	return 1;
}

export function acceptsMarkdownHeader(value: string | null): boolean {
	if (!value) return false;
	return splitMediaRanges(value).some((range) => {
		const [rawMediaType, ...parameters] = range.split(';');
		return rawMediaType?.trim().toLowerCase() === 'text/markdown' && qualityValue(parameters) > 0;
	});
}

// Injected into adapter-cloudflare's generated JavaScript. Its behavior is
// contract-tested against acceptsMarkdownHeader with the same fixture table.
export const ACCEPTS_MARKDOWN_FUNCTION_SOURCE = `(value) => {
  if (!value) return false;
  const ranges = [];
  let start = 0, quoted = false, escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) { escaped = false; continue; }
    if (character === "\\\\" && quoted) { escaped = true; continue; }
    if (character === '"') { quoted = !quoted; continue; }
    if (character === "," && !quoted) { ranges.push(value.slice(start, index)); start = index + 1; }
  }
  ranges.push(value.slice(start));
  return ranges.some((range) => {
    const parts = range.split(";");
    if ((parts.shift() || "").trim().toLowerCase() !== "text/markdown") return false;
    let quality = 1;
    for (const parameter of parts) {
      const pair = parameter.split("=");
      if ((pair.shift() || "").trim().toLowerCase() !== "q") continue;
      const candidate = pair.join("=").trim();
      quality = /^(?:0(?:\\.\\d{0,3})?|1(?:\\.0{0,3})?)$/.test(candidate) ? Number(candidate) : 0;
      break;
    }
    return quality > 0;
  });
}`;
