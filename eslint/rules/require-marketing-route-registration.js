import fs from 'node:fs';
import path from 'node:path';

const MARKETING_ROUTE_SEGMENT = `${path.sep}src${path.sep}routes${path.sep}[[lang]]${path.sep}(marketing)`;

export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Require marketing pages to be registered in public-routes.ts for llms.txt and sitemap'
		},
		schema: [],
		messages: {
			notRegistered:
				"Marketing page '{{routeKey}}' is not registered in src/lib/marketing/public-routes.ts. Add it to PUBLIC_MARKETING_ROUTES for llms.txt, sitemap, and Accept: text/markdown support."
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
				// Extract route key from path: .../[[lang]]/(marketing)/about/+page.svelte → "about"
				// Root marketing page: .../[[lang]]/(marketing)/+page.svelte → "home"
				const dir = path.dirname(filename);
				const marketingIdx = dir.indexOf(MARKETING_ROUTE_SEGMENT);
				const afterMarketing = dir
					.slice(marketingIdx + MARKETING_ROUTE_SEGMENT.length)
					.replace(/^[/\\]/, '');
				const routeKey = afterMarketing || 'home';

				// Read public-routes.ts and check if this route key is registered
				const publicRoutesPath = path.resolve(
					dir.slice(0, marketingIdx),
					'src',
					'lib',
					'marketing',
					'public-routes.ts'
				);

				if (!fs.existsSync(publicRoutesPath)) {
					return;
				}

				const content = fs.readFileSync(publicRoutesPath, 'utf-8');

				// Check for the route key in PUBLIC_MARKETING_ROUTES array
				// Matches patterns like: key: 'about' or key: "about"
				const keyPattern = new RegExp(`key:\\s*['"]${routeKey}['"]`);
				if (!keyPattern.test(content)) {
					context.report({
						node,
						messageId: 'notRegistered',
						data: { routeKey }
					});
				}
			}
		};
	}
};
