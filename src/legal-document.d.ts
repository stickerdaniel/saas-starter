// Resolved by scripts/legal-document, which parses the Markdown file at build time.
declare module '*?legal-document' {
	import type { LegalTemplate } from '#lib/content/legal-template.js';

	const template: LegalTemplate;
	export default template;
}
