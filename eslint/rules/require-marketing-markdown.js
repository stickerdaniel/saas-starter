import fs from 'node:fs';
import path from 'node:path';

const MARKETING_ROUTE_SEGMENT = `${path.sep}src${path.sep}routes${path.sep}[[lang]]${path.sep}(marketing)${path.sep}`;

export default {
	meta: {
		type: 'problem',
		docs: {
			description: 'Require sibling page.md.ts files for public marketing pages'
		},
		schema: [],
		messages: {
			missingMarkdown: 'Marketing page is missing sibling page.md.ts for agent-facing markdown.'
		}
	},
	create(context) {
		const filename = context.filename ?? context.getFilename();

		const shouldCheck =
			filename.endsWith(`${path.sep}+page.svelte`) && filename.includes(MARKETING_ROUTE_SEGMENT);

		if (!shouldCheck) {
			return {};
		}

		return {
			Program(node) {
				const markdownPath = path.join(path.dirname(filename), 'page.md.ts');

				if (!fs.existsSync(markdownPath)) {
					context.report({
						node,
						messageId: 'missingMarkdown'
					});
				}
			}
		};
	}
};
