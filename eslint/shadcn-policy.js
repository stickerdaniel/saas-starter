import { plugin } from '@shadcn/lint';

/**
 * Every script extension under src/ that the policy covers. The interim baseline gate
 * derives the tracked files it expects to be covered from this same list.
 */
export const shadcnSourceExtensions = [
	'svelte',
	'ts',
	'js',
	'mts',
	'cts',
	'mjs',
	'cjs',
	'tsx',
	'jsx'
];

// Used for integration tests until the source migration permits enforcement.
export const shadcnPolicy = {
	files: [`src/**/*.{${shadcnSourceExtensions.join(',')}}`],
	plugins: { shadcn: plugin },
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
		'shadcn/no-unknown-classes': 'error',
		'shadcn/require-static-classes': 'error'
	}
};
