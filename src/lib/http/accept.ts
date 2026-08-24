interface OfferedRepresentation {
	type: string;
	subtype: string;
	parameters: Record<string, string>;
}

/**
 * Choose Markdown only when the request ranks the UTF-8 Markdown representation
 * above the UTF-8 HTML representation. HTML wins ties because it is the default
 * representation for these URLs.
 *
 * Kept self-contained so `toString()` can inject this exact function into the
 * generated Cloudflare Worker. The shared fixture table checks both copies.
 */
export function prefersMarkdownHeader(value: string | null): boolean {
	if (!value) return false;

	function splitOutsideQuotes(input: string, delimiter: string): string[] {
		const parts: string[] = [];
		let start = 0;
		let quoted = false;
		let escaped = false;

		for (let index = 0; index < input.length; index += 1) {
			const character = input[index]!;
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
			if (character === delimiter && !quoted) {
				parts.push(input.slice(start, index));
				start = index + 1;
			}
		}
		parts.push(input.slice(start));
		return parts;
	}

	function parseQuality(rawValue: string): number {
		const candidate = rawValue.trim();
		if (!/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(candidate)) return 0;
		return Number(candidate);
	}

	function normalizeParameterValue(rawValue: string): string {
		const value = rawValue.trim();
		if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
			return value
				.slice(1, -1)
				.replace(/\\(.)/g, (_match, character: string) => character)
				.toLowerCase();
		}
		return value.toLowerCase();
	}

	const ranges = splitOutsideQuotes(value, ',').flatMap((rawRange, position) => {
		const [rawMediaType, ...rawParameters] = splitOutsideQuotes(rawRange, ';');
		const [rawType, rawSubtype, extra] = (rawMediaType ?? '').trim().toLowerCase().split('/');
		if (!rawType || !rawSubtype || extra || (rawType === '*' && rawSubtype !== '*')) return [];

		const parameters: Record<string, string> = {};
		let quality = 1;
		for (const rawParameter of rawParameters) {
			const [rawName, ...rawValueParts] = rawParameter.split('=');
			const name = rawName?.trim().toLowerCase();
			if (!name || rawValueParts.length === 0) continue;
			const rawValue = rawValueParts.join('=');
			if (name === 'q') {
				quality = parseQuality(rawValue);
				continue;
			}
			parameters[name] = normalizeParameterValue(rawValue);
		}

		return [
			{
				type: rawType,
				subtype: rawSubtype,
				parameters,
				quality,
				position
			}
		];
	});

	function qualityFor(representation: OfferedRepresentation): number {
		let best:
			| { specificity: number; parameterCount: number; position: number; quality: number }
			| undefined;

		for (const range of ranges) {
			if (range.type !== '*' && range.type !== representation.type) continue;
			if (range.subtype !== '*' && range.subtype !== representation.subtype) continue;

			const entries = Object.entries(range.parameters);
			if (
				entries.some(
					([name, expected]) => representation.parameters[name]?.toLowerCase() !== expected
				)
			) {
				continue;
			}

			const specificity = range.type === '*' ? 0 : range.subtype === '*' ? 1 : 2;
			const candidate = {
				specificity,
				parameterCount: entries.length,
				position: range.position,
				quality: range.quality
			};
			if (
				!best ||
				candidate.specificity > best.specificity ||
				(candidate.specificity === best.specificity &&
					candidate.parameterCount > best.parameterCount) ||
				(candidate.specificity === best.specificity &&
					candidate.parameterCount === best.parameterCount &&
					candidate.position < best.position)
			) {
				best = candidate;
			}
		}
		return best?.quality ?? 0;
	}

	const parameters = { charset: 'utf-8' };
	const markdownQuality = qualityFor({ type: 'text', subtype: 'markdown', parameters });
	const htmlQuality = qualityFor({ type: 'text', subtype: 'html', parameters });
	return markdownQuality > 0 && markdownQuality > htmlQuality;
}

// Injected into adapter-cloudflare's generated JavaScript. `prefersMarkdownHeader`
// is deliberately self-contained, so this is the exact server implementation.
export const PREFERS_MARKDOWN_FUNCTION_SOURCE = prefersMarkdownHeader.toString();
