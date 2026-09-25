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
		id: 'O01',
		files: ['src/lib/components/ui/owned/hero-five-cta.svelte'],
		components: {
			Button: [
				'pointer-events-auto',
				'h-12',
				'pr-3',
				'pl-5',
				'text-sm',
				'px-5',
				'text-base',
				'hover:bg-foreground/5',
				'dark:hover:bg-foreground/5'
			]
		}
	},
	{
		id: 'O02',
		files: ['src/lib/components/ui/owned/integration-learn-more-button.svelte'],
		components: {
			Button: ['pr-2']
		}
	},
	{
		id: 'O03',
		files: ['src/lib/components/ui/owned/attachment-remove-button.svelte'],
		components: {
			Button: ['p-1', 'hover:bg-secondary/50']
		}
	},
	{
		id: 'O04',
		files: ['src/lib/chat/ui/ChatAttachments.svelte'],
		components: {
			Progress: ['h-full', 'w-full', 'rounded-none']
		}
	},
	{
		id: 'O05',
		files: ['src/lib/components/ui/owned/composer-attachment-button.svelte'],
		components: {
			Button: ['border-0', 'bg-transparent', 'shadow-none']
		}
	},
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
		id: 'O08',
		files: ['src/lib/components/ErrorDisplay.svelte'],
		components: {
			Empty: ['w-full', 'max-w-xl', 'bg-background/60']
		}
	},
	{
		id: 'O09',
		files: ['src/lib/components/ai-elements/message/MessageAvatar.svelte'],
		components: {
			Avatar: ['ring-border', 'ring-1']
		}
	},
	{
		id: 'O10',
		files: ['src/lib/components/ai-elements/prompt-input/PromptInputAttachment.svelte'],
		components: {
			Button: ['absolute', '-top-1.5', '-right-1.5', 'opacity-0', 'group-hover:opacity-100']
		}
	},
	{
		id: 'O11',
		files: ['src/lib/components/ai-elements/prompt-input/PromptInputModelSelectTrigger.svelte'],
		components: {
			SelectTrigger: [
				'border-none',
				'bg-transparent',
				'font-medium',
				'text-muted-foreground',
				'shadow-none',
				'transition-colors',
				'hover:bg-accent',
				'hover:text-foreground',
				'[&[aria-expanded="true"]]:bg-accent',
				'[&[aria-expanded="true"]]:text-foreground'
			]
		}
	},
	{
		id: 'O12',
		files: ['src/lib/components/ai-elements/prompt-input/PromptInputTextarea.svelte'],
		components: {
			Textarea: [
				'w-full',
				'rounded-none',
				'border-none',
				'p-3',
				'shadow-none',
				'ring-0',
				'outline-none',
				'field-sizing-content',
				'bg-transparent',
				'dark:bg-transparent',
				'focus-visible:ring-0',
				'max-h-48',
				'min-h-16'
			]
		}
	},
	{
		id: 'O13',
		files: ['src/lib/components/ai-elements/reasoning/Reasoning.svelte'],
		components: {
			Accordion: ['not-prose', 'mb-4', 'rounded-none', 'border-0'],
			AccordionItem: ['border-0', 'data-open:bg-transparent']
		}
	},
	{
		id: 'O14',
		files: ['src/lib/components/ai-elements/reasoning/ReasoningContent.svelte'],
		components: {
			AccordionContent: ['opacity-50']
		}
	},
	{
		id: 'O15',
		files: ['src/lib/components/ai-elements/reasoning/ReasoningTrigger.svelte'],
		components: {
			AccordionTrigger: [
				'flex',
				'items-start',
				'justify-start',
				'gap-2',
				'py-0',
				'text-sm',
				'text-muted-foreground',
				'transition-colors',
				'hover:no-underline',
				'active:translate-y-px'
			]
		}
	},
	{
		id: 'O16',
		files: ['src/lib/components/ui/owned/sidebar-header-button.svelte'],
		components: {
			Button: ['w-full', 'gap-2', 'px-1.5', 'data-[state=open]:bg-muted']
		}
	},
	{
		id: 'O17',
		files: ['src/lib/components/authenticated/authenticated-sidebar.svelte'],
		components: {
			SidebarMenuAction: ['group/threads-toggle', 'transition-colors', 'active:translate-y-px']
		}
	},
	{
		id: 'O18',
		files: ['src/lib/components/ui/owned/chatbar-send-button.svelte'],
		components: {
			Button: ['text-muted-foreground']
		}
	},
	{
		id: 'O19',
		files: ['src/lib/components/customer-support/feedback-button.svelte'],
		components: {
			Button: [
				'relative',
				'transition-transform',
				'duration-150',
				'ease-out',
				'active:not-aria-[haspopup]:translate-y-0',
				'active:scale-97'
			]
		}
	},
	{
		id: 'O20',
		files: ['src/lib/components/customer-support/lazy-customer-support.svelte'],
		components: {
			Button: [
				'relative',
				'transition-[color,background-color,border-color,transform]',
				'duration-200',
				'ease-out',
				'hover:scale-105',
				'hover:bg-primary',
				'active:not-aria-[haspopup]:translate-y-0',
				'active:scale-97'
			]
		}
	},
	{
		id: 'O21',
		files: ['src/lib/components/ui/owned/screenshot-submit-button.svelte'],
		components: {
			Button: ['hidden', 'px-4', 'sm:inline-flex']
		}
	},
	{
		id: 'O22',
		files: ['src/lib/components/ui/owned/support-thread-row.svelte'],
		components: {
			Button: [
				'flex',
				'items-center',
				'gap-3',
				'border-border/30',
				'px-5',
				'transition-colors',
				'duration-150',
				'bg-muted-foreground/[0.04]',
				'hover:bg-muted-foreground/[0.06]',
				'h-auto',
				'w-full',
				'justify-start',
				'whitespace-normal',
				'font-normal',
				'shadow-none',
				'active:translate-y-0',
				'border-b',
				'p-4',
				'text-left'
			]
		}
	},
	{
		id: 'O23',
		files: ['src/lib/components/global-search/command-menu-item.svelte'],
		components: {
			CommandItem: [
				'h-9',
				'rounded-md',
				'border',
				'border-transparent',
				'!px-3',
				'font-medium',
				'data-[selected=true]:border-input',
				'data-[selected=true]:bg-input/50'
			]
		}
	},
	{
		id: 'O24',
		files: ['src/lib/components/global-search/command-menu.svelte'],
		components: {
			DialogContent: [
				'rounded-xl',
				'border-none',
				'bg-popover',
				'bg-clip-padding',
				'p-2',
				'pb-11',
				'shadow-2xl',
				'ring-4',
				'ring-foreground/5',
				'dark:ring-foreground/10'
			],
			Command: ['rounded-none', 'bg-transparent'],
			CommandEmpty: ['py-12', 'text-center', 'text-sm', 'text-muted-foreground'],
			CommandGroup: [
				'!p-0',
				'[&_[data-command-group-heading]]:scroll-mt-16',
				'[&_[data-command-group-heading]]:!p-3',
				'[&_[data-command-group-heading]]:!pb-1'
			],
			Kbd: ['bg-background']
		}
	},
	{
		id: 'O25',
		files: ['src/lib/components/global-search/command-trigger.svelte'],
		components: {
			Button: [
				'relative',
				'h-8',
				'w-full',
				'justify-start',
				'bg-sidebar-accent-hover',
				'pl-3',
				'font-medium',
				'text-foreground',
				'shadow-none',
				'md:w-48',
				'lg:w-56',
				'xl:w-64'
			]
		}
	},
	{
		id: 'O26',
		files: ['src/lib/components/ui/owned/marketing-wordmark.svelte'],
		components: {
			Button: ['-ml-3.5', 'flex', 'items-center', 'gap-2', 'px-3', 'font-semibold']
		}
	},
	{
		id: 'O27',
		files: ['src/lib/components/ui/owned/nav-user-trigger.svelte'],
		components: {
			Button: [
				'h-12',
				'w-full',
				'gap-2',
				'px-2',
				'data-[state=open]:bg-muted',
				'ring-2',
				'ring-warning'
			]
		}
	},
	{
		id: 'O28',
		files: ['src/lib/components/nav-user.svelte'],
		components: {
			DropdownMenuContent: ['w-(--bits-dropdown-menu-anchor-width)', 'min-w-56', 'rounded-lg'],
			DropdownMenuItem: ['text-warning']
		}
	},
	{
		id: 'O29',
		files: ['src/lib/components/prompt-kit/prompt-suggestion/prompt-suggestion.svelte'],
		components: {
			Button: [
				'min-w-0',
				'rounded-theme-pill',
				'px-4',
				'w-full',
				'cursor-pointer',
				'justify-start',
				'rounded-xl',
				'py-2',
				'hover:bg-accent',
				'gap-0'
			]
		}
	},
	{
		id: 'O30',
		files: ['src/lib/components/prompt-kit/scroll-button/ScrollButton.svelte'],
		components: {
			Button: [
				'transition-all',
				'duration-150',
				'ease-out',
				'active:not-aria-[haspopup]:translate-y-0',
				'translate-y-0',
				'scale-100',
				'opacity-100',
				'pointer-events-none',
				'translate-y-4',
				'scale-95',
				'opacity-0'
			]
		}
	},
	{
		id: 'O31',
		files: ['src/lib/components/prompt-kit/tool/Tool.svelte'],
		components: {
			Collapsible: ['not-prose', 'mb-4', 'overflow-hidden', 'rounded-lg', 'border', 'border-border']
		}
	},
	{
		id: 'O32',
		files: ['src/lib/components/prompt-kit/tool/ToolContent.svelte'],
		components: {
			CollapsibleContent: [
				'border-t',
				'border-border',
				'overflow-hidden',
				'data-[state=closed]:animate-collapsible-up',
				'data-[state=open]:animate-collapsible-down'
			]
		}
	},
	{
		id: 'O33',
		files: ['src/lib/components/prompt-kit/tool/ToolHeader.svelte'],
		components: {
			Button: [
				'h-auto',
				'w-full',
				'justify-between',
				'rounded-t-lg',
				'rounded-b-none',
				'bg-background',
				'px-3',
				'py-2',
				'font-normal'
			]
		}
	},
	{
		id: 'O34',
		files: ['src/lib/components/ui/command/command-dialog.svelte'],
		components: {
			DialogContent: ['top-1/3', 'translate-y-0', 'overflow-hidden', 'rounded-xl!', 'p-0']
		}
	},
	{
		id: 'O35',
		files: ['src/lib/components/ui/command/command-input.svelte'],
		components: {
			InputGroup: [
				'h-8!',
				'rounded-lg!',
				'border-input/30',
				'bg-input/30',
				'shadow-none!',
				'*:data-[slot=input-group-addon]:pl-2!'
			]
		}
	},
	{
		id: 'O36',
		files: ['src/lib/components/ui/field/field-label.svelte'],
		components: {
			Label: [
				'group/field-label',
				'peer/field-label',
				'flex',
				'w-fit',
				'gap-2',
				'leading-snug',
				'group-data-[disabled=true]/field:opacity-50',
				'has-data-checked:border-primary/30',
				'has-data-checked:bg-primary/5',
				'has-[>[data-slot=field]]:rounded-md',
				'has-[>[data-slot=field]]:border',
				'*:data-[slot=field]:p-3',
				'dark:has-data-checked:border-primary/20',
				'dark:has-data-checked:bg-primary/10',
				'has-[>[data-slot=field]]:w-full',
				'has-[>[data-slot=field]]:flex-col'
			]
		}
	},
	{
		id: 'O37',
		files: ['src/lib/components/ui/input-group/input-group-button.svelte'],
		components: {
			Button: [
				'flex',
				'items-center',
				'gap-2',
				'text-sm',
				'shadow-none',
				'h-6',
				'gap-1',
				'rounded-[calc(var(--radius)-5px)]',
				'px-1.5',
				"[&>svg:not([class*='size-'])]:size-3.5",
				'size-6',
				'p-0',
				'has-[>svg]:p-0',
				'size-8'
			]
		}
	},
	{
		id: 'O38',
		files: ['src/lib/components/ui/input-group/input-group-input.svelte'],
		components: {
			Input: [
				'flex-1',
				'rounded-none',
				'border-0',
				'bg-transparent',
				'shadow-none',
				'ring-0',
				'focus-visible:ring-0',
				'aria-invalid:ring-0',
				'dark:bg-transparent'
			]
		}
	},
	{
		id: 'O39',
		files: ['src/lib/components/ui/input-group/input-group-textarea.svelte'],
		components: {
			Textarea: [
				'flex-1',
				'rounded-none',
				'border-0',
				'bg-transparent',
				'py-2',
				'shadow-none',
				'ring-0',
				'focus-visible:ring-0',
				'aria-invalid:ring-0',
				'dark:bg-transparent'
			]
		}
	},
	{
		id: 'O40',
		files: ['src/lib/components/ui/metric-card.svelte'],
		components: {
			Card: ['@container/card', 'border-destructive/50'],
			CardDescription: ['text-destructive'],
			CardTitle: [
				'flex',
				'items-center',
				'gap-2',
				'text-2xl',
				'font-semibold',
				'tabular-nums',
				'@[250px]/card:text-3xl',
				'text-destructive'
			],
			CardFooter: ['flex-col', 'items-start', 'gap-1.5', 'text-sm'],
			Badge: ['text-destructive', 'text-success']
		}
	},
	{
		id: 'O41',
		files: ['src/lib/components/ui/password/password-copy.svelte'],
		components: {
			CopyButton: [
				'absolute',
				'top-1/2',
				'right-0',
				'size-9',
				'min-w-0',
				'-translate-y-1/2',
				'text-muted-foreground',
				'hover:!bg-transparent'
			]
		}
	},
	{
		id: 'O42',
		files: ['src/lib/components/ui/password/password-input.svelte'],
		components: {
			Input: ['transition-all', 'pr-9', 'pr-18']
		}
	},
	{
		id: 'O43',
		files: ['src/lib/components/ui/password/password-toggle-visibility.svelte'],
		components: {
			Toggle: [
				'absolute',
				'top-1/2',
				'right-0',
				'size-9',
				'min-w-0',
				'-translate-y-1/2',
				'p-0',
				'opacity-0',
				'transition-opacity',
				'group-focus-within/password:opacity-100',
				'group-hover/password:opacity-100',
				'hover:!bg-transparent',
				'data-[state=off]:text-muted-foreground',
				'hover:data-[state=off]:text-accent-foreground',
				'data-[state=on]:bg-transparent',
				'data-[state=on]:text-muted-foreground',
				'hover:data-[state=on]:text-accent-foreground',
				'right-9',
				'max-w-6'
			]
		}
	},
	{
		id: 'O45',
		files: ['src/lib/components/ui/sidebar/sidebar-input.svelte'],
		components: {
			Input: ['h-8', 'w-full', 'bg-background', 'shadow-none']
		}
	},
	{
		id: 'O46',
		files: ['src/lib/components/ui/sidebar/sidebar-separator.svelte'],
		components: {
			Separator: ['mx-2', 'w-auto', 'bg-sidebar-border']
		}
	},
	{
		id: 'O47',
		files: ['src/lib/components/ui/sidebar/sidebar.svelte'],
		components: {
			SheetContent: [
				'w-(--sidebar-width)',
				'bg-sidebar',
				'p-0',
				'text-sidebar-foreground',
				'[&>button]:hidden'
			]
		}
	},
	{
		id: 'O48',
		files: [
			'src/routes/[[lang]]/(auth)/signin/+page.svelte',
			'src/routes/[[lang]]/(auth)/signup/+page.svelte'
		],
		components: {
			Card: ['overflow-hidden', 'p-0', 'auth-card-transition']
		}
	},
	{
		id: 'O50',
		files: ['src/lib/components/ui/owned/filter-chip-remove-button.svelte'],
		components: {
			Button: ['size-4', 'text-muted-foreground', 'hover:bg-foreground/10', 'hover:text-foreground']
		}
	},
	{
		id: 'O51',
		files: ['src/routes/[[lang]]/admin/audit-log/user-ref-cell.svelte'],
		components: {
			Button: [
				'group',
				'h-auto',
				'w-full',
				'justify-start',
				'whitespace-normal',
				'font-normal',
				'shadow-none',
				'active:translate-y-0',
				'flex',
				'min-w-0',
				'cursor-pointer',
				'items-center',
				'gap-2',
				'rounded-md',
				'text-left'
			]
		}
	},
	{
		id: 'O52',
		files: ['src/lib/components/ui/owned/founder-body-preview-button.svelte'],
		components: {
			Button: [
				'max-h-60',
				'h-auto',
				'w-full',
				'justify-start',
				'whitespace-normal',
				'font-normal',
				'shadow-none',
				'active:translate-y-0',
				'cursor-text',
				'overflow-y-auto',
				'rounded-md',
				'border',
				'bg-muted/30',
				'p-3',
				'text-left',
				'text-sm'
			]
		}
	},
	{
		id: 'O53',
		files: ['src/lib/components/ui/owned/founder-reset-confirm-action.svelte'],
		components: {
			AlertDialogAction: ['bg-destructive', 'text-white', 'hover:bg-destructive/90']
		}
	},
	{
		id: 'O54',
		files: ['src/routes/[[lang]]/admin/settings/recipients-actions.svelte'],
		components: {
			Button: ['text-muted-foreground', 'hover:text-destructive']
		}
	},
	{
		id: 'O55',
		files: ['src/lib/components/ui/owned/admin-thread-row.svelte'],
		components: {
			Button: [
				'dark:bg-muted/20',
				'bg-muted/70',
				'dark:bg-muted/35',
				'hover:bg-muted/30',
				'dark:hover:bg-muted/50',
				'h-auto',
				'w-full',
				'justify-start',
				'whitespace-normal',
				'font-normal',
				'shadow-none',
				'active:translate-y-0',
				'border-b',
				'p-4',
				'text-left'
			]
		}
	},
	{
		id: 'O56',
		files: ['src/lib/components/ui/owned/user-ban-menu-item.svelte'],
		components: {
			DropdownMenuItem: ['text-destructive']
		}
	},
	{
		id: 'O57',
		files: ['src/lib/components/ui/owned/passkey-delete-button.svelte'],
		components: {
			Button: ['text-destructive', 'hover:text-destructive']
		}
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
	return Array.from(byFile, ([file, components]) => ({
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
	}));
}

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
		'shadcn/no-arbitrary-values': ['error', { allow: arbitraryValueExceptions }],
		'shadcn/no-restyle': ['error', restyleOptions]
	}
};

// Spread by eslint.config.js: the enforced policy, the no-restyle owner files, and
// the path exceptions.
export const enforcedShadcnConfig = [
	enforcedShadcnPolicy,
	...restyleEntries(),
	// Email clients cannot read theme variables or stylesheet classes reliably, so
	// templates inline literal colors and styles.
	{
		files: ['src/lib/emails/**'],
		rules: { 'shadcn/no-raw-colors': 'off', 'shadcn/no-inline-styles': 'off' }
	},
	// Brand logos reproduce each vendor's own fills.
	{ files: ['src/blocks/logos/**'], rules: { 'shadcn/no-raw-colors': 'off' } }
];
