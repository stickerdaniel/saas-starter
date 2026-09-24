import { plugin } from '@shadcn/lint';

const files = ['src/**/*.{svelte,ts,js}'];
const plugins = { shadcn: plugin };

// Arbitrary values with no theme token or scale step that reproduces them. The rule
// matches each entry by exact class name, including its variant and negative forms;
// it reads an entry containing ':' as the whole token and a '*' as a wildcard.
const arbitraryValueExceptions = [
	// Button, InputGroup, Checkbox, Switch, and Tooltip primitives: radius clamps, kbd
	// optical offsets, the drawn checkbox box and stroke length, the 18.4px switch
	// track, and arrow nudges have no step on the radius, spacing, or translate scales.
	'rounded-[min(var(--radius-md),8px)]',
	'rounded-[min(var(--radius-md),10px)]',
	'rounded-[calc(var(--radius)-5px)]',
	'ml-[-0.15rem]',
	'mr-[-0.15rem]',
	'rounded-[4px]',
	'[--check-len:23]',
	'h-[18.4px]',
	'translate-y-[calc(-50%-2px)]',
	'translate-y-[calc(-50%+2px)]',
	'-translate-y-[calc(-50%+1px)]',
	'translate-x-[calc(50%+2px)]',
	'-translate-y-[calc(50%-3px)]',
	// AlertDialog, Alert, CardHeader, and the account settings upload row: track
	// templates mixing auto and fr have no grid-cols-N or grid-rows-N spelling.
	'grid-rows-[auto_1fr]',
	'grid-rows-[auto_auto_1fr]',
	'grid-rows-[auto_auto]',
	'grid-cols-[auto_1fr]',
	'grid-cols-[1fr_auto]',
	'grid-cols-[1fr_auto_1fr]',
	// ScrollArea, ProgressiveBlur, the chat composer pill, and PromptSuggestion: an
	// inherited radius, the composer's 25px pill, and a pill that turns square with a
	// zero theme radius are not radius tokens.
	'rounded-[inherit]',
	'rounded-[25px]',
	'rounded-[calc(9999px*sign(var(--radius)))]',
	// Sidebar, Dialog, chat scroll buttons, marketing shell, hero, and attachment tiles:
	// each calc couples a length to a variable, a percentage, or a sibling gap.
	'w-[calc(var(--sidebar-width-icon)+(--spacing(4)))]',
	'w-[calc(var(--sidebar-width-icon)+(--spacing(4))+2px)]',
	'max-w-[calc(100%-2rem)]',
	'right-[calc(var(--scrollbar-w,0px)+0.25rem)]',
	'right-[calc(var(--scrollbar-w,0px)+0.75rem)]',
	'w-[calc(100%+1rem)]',
	'w-[calc(100%+4rem)]',
	'w-[calc(100%-11rem)]',
	'w-[calc(50%-0.25rem)]',
	// Admin support skeletons: the measured 17.5px line box has no spacing step,
	// since h-4.375 generates no CSS.
	'h-[17.5px]',
	// Attachment previews, Drawer, feedback widget, sidebar thread list, founder welcome
	// card, and admin support: viewport fractions and viewport-minus-chrome heights
	// have no scale step.
	'h-[70vh]',
	'max-h-[70vh]',
	'max-h-[80vh]',
	'h-[50vh]',
	'h-[85svh]',
	'max-h-[calc(100svh-18rem)]',
	'max-h-[calc(100svh-3rem-0.75rem-1.25rem-1.25rem)]',
	'max-h-[calc(100dvh-2rem)]',
	// Sidebar, Tabs, SlidingPanel, FollowingPointer, prompt attachments, the support
	// launcher and chat bar, and the marketing header: exact transition lanes, and the
	// panel's curve, which Tailwind's transition and ease scales do not name.
	'transition-[height]',
	'transition-[width]',
	'transition-[width,height]',
	'transition-[width,height,padding]',
	'transition-[margin,opacity]',
	'transition-[left,right,width]',
	'transition-[transform,width]',
	'transition-[transform,width,height]',
	'transition-[transform,opacity]',
	'transition-[max-width,translate]',
	'transition-[color,background-color,border-color,transform]',
	'transition-[height,transform,background-color,border-color]',
	'ease-[cubic-bezier(0.23,1,0.32,1)]'
];

// Enforced by eslint.config.js. Each allowed unknown class is supplied outside
// Tailwind's class grammar: ai-elements selectors read is-user/is-assistant, the
// typography plugin defines not-prose, legal-markdown.test.ts asserts legal-literal,
// and svelte-sonner styles toaster. Allow further classes by exact name only.
export const enforcedShadcnPolicy = {
	files,
	plugins,
	rules: {
		'shadcn/no-unknown-classes': [
			'error',
			{ allow: ['is-user', 'is-assistant', 'not-prose', 'legal-literal', 'toaster'] }
		],
		'shadcn/require-static-classes': 'error',
		'shadcn/no-raw-colors': 'error',
		'shadcn/no-inline-styles': 'error',
		'shadcn/no-arbitrary-values': ['error', { allow: arbitraryValueExceptions }]
	}
};

// Spread by eslint.config.js: the enforced policy followed by its path exceptions.
export const enforcedShadcnConfig = [
	enforcedShadcnPolicy,
	// Email clients cannot read theme variables or stylesheet classes reliably, so
	// templates inline literal colors and styles.
	{
		files: ['src/lib/emails/**'],
		rules: { 'shadcn/no-raw-colors': 'off', 'shadcn/no-inline-styles': 'off' }
	},
	// Brand logos reproduce each vendor's own fills.
	{ files: ['src/blocks/logos/**'], rules: { 'shadcn/no-raw-colors': 'off' } }
];

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
		...enforcedShadcnPolicy.rules
	}
};
