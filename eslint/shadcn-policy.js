import { plugin } from '@shadcn/lint';

// Used for integration tests until the source migration permits enforcement.
export const shadcnPolicy = {
	files: ['src/**/*.{svelte,ts,js}'],
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
