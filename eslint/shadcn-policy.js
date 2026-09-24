import { plugin } from '@shadcn/lint';

const files = ['src/**/*.{svelte,ts,js}'];
const plugins = { shadcn: plugin };

// Arbitrary values with no theme token or scale step that reproduces them. The rule
// matches each entry by exact class name, including its variant and negative forms;
// it reads an entry containing ':' as the whole token and a '*' as a wildcard. An
// entry therefore also admits its sign flip and anything in place of a '*', so a value
// whose negation or wildcard would admit other geometry needs a named utility instead.
const arbitraryValueExceptions = [
	// Button, InputGroup, Checkbox, and Switch primitives: radius clamps, kbd optical
	// offsets, the drawn checkbox box and stroke length, and the 18.4px switch track
	// have no step on the radius or spacing scales.
	'rounded-[min(var(--radius-md),8px)]',
	'rounded-[min(var(--radius-md),10px)]',
	'rounded-[calc(var(--radius)-5px)]',
	'ml-[-0.15rem]',
	'mr-[-0.15rem]',
	'rounded-[4px]',
	'[--check-len:23]',
	'h-[18.4px]',
	// AlertDialog, Alert, CardHeader, and the account settings upload row: track
	// templates mixing auto and fr have no grid-cols-N or grid-rows-N spelling.
	'grid-rows-[auto_1fr]',
	'grid-rows-[auto_auto_1fr]',
	'grid-rows-[auto_auto]',
	'grid-cols-[auto_1fr]',
	'grid-cols-[1fr_auto]',
	'grid-cols-[1fr_auto_1fr]',
	// ScrollArea, ProgressiveBlur, and the chat composer pill: an inherited radius and
	// the composer's 25px pill are not radius tokens.
	'rounded-[inherit]',
	'rounded-[25px]',
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

// no-restyle: a caller places a design-system component; its look comes from the
// component's own options. A component no contract names keeps the layout default.
// The rule applies only the last contract whose pattern matches, so order matters.

// Where a control sits, never its size, padding, color, type, radius or motion.
const placement = [
	'm',
	'mx',
	'my',
	'mt',
	'mr',
	'mb',
	'ml',
	'ms',
	'me',
	'w-full',
	'min-w-0',
	'max-w-full',
	'shrink',
	'shrink-0',
	'grow',
	'flex-1',
	'order',
	'align-self',
	'place-self',
	'justify-self',
	'col-start-end',
	'row-start-end',
	'static',
	'relative',
	'absolute',
	'fixed',
	'sticky',
	'inset',
	'inset-x',
	'inset-y',
	'top',
	'right',
	'bottom',
	'left',
	'z',
	'hidden',
	'invisible',
	'visible',
	'sr-only',
	'block',
	'flex',
	'inline-flex',
	'pointer-events-none',
	'pointer-events-auto',
	'group'
];

// Controls and the names wrappers resolve to. The rule reports some wrappers under
// the primitive they forward to and others under their own name, so both are listed.
const strictControls = [
	'Button',
	'CopyButton',
	'ScrollButton',
	'PromptSuggestion',
	'CommandTrigger',
	'NavigationButton',
	'AlertDialogAction',
	'AlertDialogCancel',
	'InputGroupButton',
	'Badge',
	'Input',
	'SidebarInput',
	'InputGroupInput',
	'Textarea',
	'PromptInputTextarea',
	'InputGroupTextarea',
	'SelectTrigger',
	'TabsTrigger',
	'Toggle',
	'Avatar',
	'AvatarImage',
	'AvatarFallback',
	'Kbd',
	'KbdGroup'
];

// Private recipe owners under components/ui/owned. The rule reports each under its
// own name, which would otherwise fall back to the layout default and reopen sizes.
const privateOwners = [
	'AdminThreadRow',
	'AttachmentRemoveButton',
	'ChatbarSendButton',
	'ComposerAttachmentButton',
	'FilterChipRemoveButton',
	'FounderBodyPreviewButton',
	'FounderResetConfirmAction',
	'HeroFiveCta',
	'IntegrationLearnMoreButton',
	'MarketingWordmark',
	'NavUserTrigger',
	'PasskeyDeleteButton',
	'ScreenshotSubmitButton',
	'SidebarHeaderButton',
	'SupportThreadRow',
	'UserBanMenuItem'
];

export const restyleOptions = {
	allow: ['layout'],
	contracts: [
		// Containers arrange their content; appearance stays with the component.
		{ pattern: '^(Card|CardHeader|CardFooter|CardContent)$', allow: ['layout', 'spacing'] },
		{ pattern: '^(Tabs|TabsContent)$', allow: ['layout', 'spacing'] },
		{ pattern: '^(Field|FieldContent|FieldSet|FieldLegend)$', allow: ['layout', 'spacing'] },
		{ pattern: '^FieldGroup$', allow: ['w-full'] },
		// Auth helper text is balanced and centered below its form.
		{
			pattern: '^FieldDescription$',
			allow: ['layout', 'spacing', 'text-center', 'text-balance']
		},
		{
			pattern:
				'^(DialogContent|DialogHeader|DialogFooter|DrawerContent|DrawerFooter|SheetContent|SheetFooter|AlertDialogContent|AlertDialogFooter)$',
			allow: ['layout', 'spacing']
		},
		// A long attachment title truncates clear of the close button.
		{ pattern: '^DialogTitle$', allow: ['layout', 'spacing', 'truncate'] },
		{
			pattern: '^(SidebarContent|SidebarGroup|SidebarGroupContent|SidebarMenu)$',
			allow: ['layout', 'spacing']
		},
		{ pattern: '^SidebarMenuSub$', allow: ['layout', 'spacing', 'no-scrollbar'] },
		{
			pattern: '^(Table|TableHeader|TableBody|TableRow|TableHead|TableCell|TableFooter)$',
			allow: ['layout', 'spacing']
		},
		{
			pattern: '^(Item|ItemGroup|ItemHeader|ItemContent|ItemFooter)$',
			allow: ['layout', 'spacing']
		},
		// Only the two non-default skeleton radii; shape would also admit rings and borders.
		{ pattern: '^Skeleton$', allow: ['layout', 'rounded-full', 'rounded-4xl'] },
		{ pattern: '^ColorSelector$', allow: ['layout', 'spacing'] },
		{ pattern: '^BreadcrumbList$', allow: ['layout', 'truncate'] },
		// Last, so no container entry reopens a control.
		{ pattern: `^(${[...strictControls, ...privateOwners].join('|')})$`, allow: placement }
	]
};

// The one file that owns each recipe may keep these classes on the named
// components. Every other file, including callers of the owner, stays strict.
export const restyleOwners = [
	{
		id: 'O06',
		files: ['src/lib/components/prompt-kit/prompt-input/PromptInputTextarea.svelte'],
		components: {
			Textarea: [
				'min-h-11',
				'w-full',
				'border-none',
				'!bg-transparent',
				'text-foreground',
				'shadow-none',
				'outline-none',
				'placeholder-shown:overflow-hidden',
				'placeholder-shown:whitespace-nowrap',
				'focus-visible:ring-0',
				'focus-visible:ring-offset-0',
				'min-h-9',
				'py-2',
				'text-base',
				'leading-5',
				'pr-2',
				'pl-3',
				'px-1',
				'composer-scroll-mask',
				'pt-3',
				'pl-4',
				'leading-composer',
				'!h-auto',
				'!min-h-auto',
				'rounded-full',
				'bg-transparent',
				'!py-0',
				'max-h-(--prompt-max-height)'
			]
		}
	},
	{
		id: 'O14',
		files: ['src/lib/components/ai-elements/reasoning/ReasoningContent.svelte'],
		components: { AccordionContent: ['opacity-50'] }
	}
];

// Route directories such as [[lang]] are literal names, not glob character classes.
function literalFile(path) {
	return path.replaceAll('[', '\\[').replaceAll(']', '\\]');
}

function inheritedAllow(component) {
	let allow = restyleOptions.allow;
	for (const contract of restyleOptions.contracts) {
		if (new RegExp(contract.pattern).test(component)) allow = contract.allow;
	}
	return allow;
}

// A later flat-config entry replaces the rule's options instead of merging them, so
// each owner file gets one entry that repeats every base contract and then appends a
// contract per owned component with the inherited allowance plus the owner's classes.
export function restyleEntries(owners = restyleOwners) {
	const byFile = new Map();
	for (const owner of owners) {
		for (const file of owner.files) {
			const components = byFile.get(file) ?? new Map();
			for (const [component, additions] of Object.entries(owner.components)) {
				components.set(component, [
					...new Set([...(components.get(component) ?? []), ...additions])
				]);
			}
			byFile.set(file, components);
		}
	}
	return [
		{ files, plugins, rules: { 'shadcn/no-restyle': ['error', restyleOptions] } },
		...Array.from(byFile, ([file, components]) => ({
			files: [literalFile(file)],
			rules: {
				'shadcn/no-restyle': [
					'error',
					{
						...restyleOptions,
						contracts: [
							...restyleOptions.contracts,
							...Array.from(components, ([component, additions]) => ({
								pattern: `^${component}$`,
								allow: [...new Set([...inheritedAllow(component), ...additions])]
							}))
						]
					}
				]
			}
		}))
	];
}

// Measures the migration until no-restyle is clean enough to join the enforced config.
export const shadcnPolicy = [enforcedShadcnPolicy, ...restyleEntries()];
