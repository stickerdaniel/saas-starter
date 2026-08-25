const EXTERNAL_OR_ROOT_TARGET = /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i;
const INLINE_LINK_TARGET =
	/(\]\(\s*)(<[^>\r\n]+>|[^)\s]+)(?=(?:\s+(?:"[^"\r\n]*"|'[^'\r\n]*'|\([^\r\n)]*\)))?\s*\))/g;
const REFERENCE_LINK_TARGET = /^(\s{0,3}\[[^\]\r\n]+\]:[ \t]*)(<[^>\r\n]+>|[^\s\r\n]+)(.*)$/gm;

function localizeTarget(target: string, localize: (path: string) => string): string {
	const wrapped = target.startsWith('<') && target.endsWith('>');
	const destination = wrapped ? target.slice(1, -1) : target;
	if (EXTERNAL_OR_ROOT_TARGET.test(destination)) return target;
	const localized = localize(`/${destination}`);
	return wrapped ? `<${localized}>` : localized;
}

export function localizeRelativeMarkdownLinks(
	content: string,
	localize: (path: string) => string
): string {
	return content
		.replace(INLINE_LINK_TARGET, (_match, prefix: string, target: string) => {
			return `${prefix}${localizeTarget(target, localize)}`;
		})
		.replace(REFERENCE_LINK_TARGET, (_match, prefix: string, target: string, suffix: string) => {
			return `${prefix}${localizeTarget(target, localize)}${suffix}`;
		});
}
