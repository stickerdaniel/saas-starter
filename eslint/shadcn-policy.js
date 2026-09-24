import { plugin } from '@shadcn/lint';

const files = ['src/**/*.{svelte,ts,js}'];
const plugins = { shadcn: plugin };

// Enforced by eslint.config.js. Each allowed class is supplied outside Tailwind's
// class grammar: ai-elements selectors read is-user/is-assistant, the typography
// plugin defines not-prose, legal-markdown.test.ts asserts legal-literal, and
// svelte-sonner styles toaster. Allow further classes by exact name only.
export const enforcedShadcnPolicy = {
	files,
	plugins,
	rules: {
		'shadcn/no-unknown-classes': [
			'error',
			{ allow: ['is-user', 'is-assistant', 'not-prose', 'legal-literal', 'toaster'] }
		],
		'shadcn/require-static-classes': 'error'
	}
};

// Used for integration tests until the source migration permits enforcing the
// remaining rules.
export const shadcnPolicy = {
	files,
	plugins,
	rules: {
		'shadcn/no-restyle': [
			'error',
			{
				allow: ['layout'],
				contracts: [
					{
						pattern: '^Button$',
						allow: ['m', 'mx', 'my', 'mt', 'mr', 'mb', 'ml', 'ms', 'me', 'w-full']
					},
					{ pattern: '^FieldGroup$', allow: ['w-full'] },
					{ pattern: '^CardContent$', allow: ['layout', 'spacing'] }
				]
			}
		],
		'shadcn/no-raw-colors': 'error',
		'shadcn/no-arbitrary-values': 'error',
		'shadcn/no-inline-styles': 'error',
		...enforcedShadcnPolicy.rules
	}
};
