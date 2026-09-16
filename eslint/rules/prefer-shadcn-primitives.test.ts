// @vitest-environment node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import parser from 'svelte-eslint-parser';
import { describe, expect, it } from 'vitest';
import rule from './prefer-shadcn-primitives.js';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function lint(
	template: string,
	filename = 'src/lib/components/app.svelte'
): Array<{ messageId: string }> {
	const reports: Array<{ messageId: string }> = [];
	const ast = parser.parseForESLint(template, {});

	const context = {
		report: (opts: { messageId: string }) => reports.push(opts),
		getFilename: () => filename,
		filename
	};

	const listeners = rule.create(context);

	function walk(node: Record<string, unknown>, parent: Record<string, unknown> | null) {
		if (!node || typeof node !== 'object') return;
		node.parent = parent as unknown as never;
		const type = node.type as string;
		if (type && typeof listeners[type] === 'function') {
			(listeners[type] as (n: unknown) => void)(node);
		}
		for (const key of Object.keys(node)) {
			if (key === 'parent') continue;
			const val = node[key];
			if (Array.isArray(val)) val.forEach((v) => walk(v as Record<string, unknown>, node));
			else if (val && typeof val === 'object' && (val as Record<string, unknown>).type)
				walk(val as Record<string, unknown>, node);
		}
	}

	walk(ast.ast as unknown as Record<string, unknown>, null);
	return reports;
}

function ids(reports: Array<{ messageId: string }>): string[] {
	return reports.map((r) => r.messageId);
}

function sortedIds(reports: Array<{ messageId: string }>): string[] {
	return [...ids(reports)].sort();
}

const PRIMITIVE_CASES = [
	{
		key: 'button',
		source: '<button type="button">Save</button>',
		messageId: 'nativeButton',
		importPath: '$lib/components/ui/button'
	},
	{
		key: 'dialog',
		source: '<dialog>Help</dialog>',
		messageId: 'nativeDialog',
		importPath: '$lib/components/ui/dialog'
	},
	{
		key: 'title',
		source: '<span title="More information">Help</span>',
		messageId: 'nativeTitle',
		importPath: '$lib/components/ui/tooltip'
	},
	{
		key: 'checkbox',
		source: '<input type="checkbox" />',
		messageId: 'nativeCheckbox',
		importPath: '$lib/components/ui/checkbox'
	},
	{
		key: 'select',
		source: '<select></select>',
		messageId: 'nativeSelect',
		importPath: '$lib/components/ui/select'
	},
	{
		key: 'textarea',
		source: '<textarea></textarea>',
		messageId: 'nativeTextarea',
		importPath: '$lib/components/ui/textarea'
	},
	{
		key: 'input-text',
		source: '<input type="text" />',
		messageId: 'nativeInput',
		importPath: '$lib/components/ui/input'
	},
	{
		key: 'input-email',
		source: '<input type="email" />',
		messageId: 'nativeInput',
		importPath: '$lib/components/ui/input'
	},
	{
		key: 'input-password',
		source: '<input type="password" />',
		messageId: 'nativeInput',
		importPath: '$lib/components/ui/input'
	},
	{
		key: 'input-search',
		source: '<input type="search" />',
		messageId: 'nativeInput',
		importPath: '$lib/components/ui/input'
	},
	{
		key: 'input-tel',
		source: '<input type="tel" />',
		messageId: 'nativeInput',
		importPath: '$lib/components/ui/input'
	},
	{
		key: 'input-url',
		source: '<input type="url" />',
		messageId: 'nativeInput',
		importPath: '$lib/components/ui/input'
	},
	{
		key: 'input-number',
		source: '<input type="number" />',
		messageId: 'nativeInput',
		importPath: '$lib/components/ui/input'
	},
	{
		key: 'input-default',
		source: '<input />',
		messageId: 'nativeInput',
		importPath: '$lib/components/ui/input'
	}
] as const;

const EMAIL_PATHS = [
	'src/lib/emails/NewEmail.svelte',
	'src/lib/emails/templates/NewPromoEmail.svelte',
	'src/lib/emails/future/deep/NewPromoEmail.svelte',
	'src/lib/emails/components/layout/EmailHeader.svelte'
];

const EXEMPT_PATH_CASES = [
	'src/lib/components/ui/future/primitive.svelte',
	'src/lib/components/ai-elements/future/primitive.svelte',
	'src/lib/components/prompt-kit/future/primitive.svelte',
	'src/lib/chat/ui/test-fixtures/future/primitive.svelte',
	'src/lib/components/obfuscated-email.svelte'
];

const APP_GATED_PATHS = [
	'src/routes/[[lang]]/app/settings/email-settings.svelte',
	'src/routes/[[lang]]/admin/settings/add-email-dialog.svelte',
	'src/routes/[[lang]]/app/settings/add-email-dialog.svelte',
	'src/lib/components/app.svelte',
	'src/lib/chat/ui/PrimitiveExample.svelte',
	'src/lib/emails-old/NewPromoEmail.svelte',
	'src/lib/components/email-settings.svelte',
	'src/lib/components/obfuscated-email-copy.svelte'
];

function filenameVariants(relativePath: string): string[] {
	return [
		relativePath,
		`./${relativePath}`,
		path.join(repoRoot, relativePath),
		`C:\\repo\\${relativePath.replaceAll('/', '\\')}`
	];
}

const eslint = new ESLint({ cwd: repoRoot });

async function assertConfiguredAtError(filename: string) {
	expect(await eslint.isPathIgnored(filename)).toBe(false);
	const config = await eslint.calculateConfigForFile(filename);
	expect(config).toBeTruthy();
	expect(config.rules?.['local/prefer-shadcn-primitives']?.[0]).toBe(2);
}

const EXPECTED_MESSAGES = {
	nativeButton:
		'Use shadcn Button from $lib/components/ui/button instead of a native <button>. Spread {...props} onto <button> only as a bits-ui child host.',
	nativeDialog: 'Use shadcn Dialog from $lib/components/ui/dialog instead of a native <dialog>.',
	nativeTitle:
		'Use shadcn Tooltip from $lib/components/ui/tooltip instead of the HTML title tooltip.',
	nativeCheckbox:
		'Use shadcn Checkbox from $lib/components/ui/checkbox instead of a native <input type="checkbox">.',
	nativeSelect: 'Use shadcn Select from $lib/components/ui/select instead of a native <select>.',
	nativeTextarea:
		'Use shadcn Textarea from $lib/components/ui/textarea instead of a native <textarea>.',
	nativeInput:
		'Use shadcn Input from $lib/components/ui/input instead of a native text-like <input>.'
} as const;

const TEXT_LIKE_TYPES = ['text', 'email', 'password', 'search', 'tel', 'url', 'number'] as const;

const ALL_EXEMPT_PATHS = [
	...EMAIL_PATHS,
	'src/lib/emails/templates/VerificationEmail.svelte',
	...EXEMPT_PATH_CASES
];

const SCOPED_CASES = [
	{
		name: 'host button plus title',
		source: '<button type="button" {...props} title="Help">Save</button>',
		expected: ['nativeTitle']
	},
	{
		name: 'host button plus shorthand title',
		source: '<button type="button" {...props} {title}>Save</button>',
		expected: ['nativeTitle']
	},
	{
		name: 'rest spread plus title',
		source: '<button type="button" {...rest} title="Help">Save</button>',
		expected: ['nativeButton', 'nativeTitle']
	},
	{ name: 'dialog props', source: '<dialog {...props}>Help</dialog>', expected: ['nativeDialog'] },
	{
		name: 'dialog props plus title',
		source: '<dialog {...props} title="Help">Help</dialog>',
		expected: ['nativeDialog', 'nativeTitle']
	},
	{
		name: 'checkbox props',
		source: '<input type="checkbox" {...props} />',
		expected: ['nativeCheckbox']
	},
	{
		name: 'checkbox props-first',
		source: '<input {...props} type="checkbox" />',
		expected: ['nativeCheckbox']
	},
	{
		name: 'checkbox props plus title',
		source: '<input type="checkbox" {...props} title="Help" />',
		expected: ['nativeCheckbox', 'nativeTitle']
	},
	{ name: 'select props', source: '<select {...props}></select>', expected: ['nativeSelect'] },
	{
		name: 'textarea props',
		source: '<textarea {...props}></textarea>',
		expected: ['nativeTextarea']
	},
	{
		name: 'select props plus title',
		source: '<select {...props} title="Help"></select>',
		expected: ['nativeSelect', 'nativeTitle']
	},
	{
		name: 'textarea props plus title',
		source: '<textarea {...props} title="Help"></textarea>',
		expected: ['nativeTextarea', 'nativeTitle']
	},
	{
		name: 'text props',
		source: '<input type="text" {...props} />',
		expected: ['nativeInput']
	},
	{
		name: 'text props-first',
		source: '<input {...props} type="text" />',
		expected: ['nativeInput']
	},
	{
		name: 'email props plus title',
		source: '<input type="email" {...props} title="Help" />',
		expected: ['nativeInput', 'nativeTitle']
	},
	{
		name: 'file hidden props plus title',
		source: '<input type="file" hidden {...props} title="Help" />',
		expected: ['nativeTitle']
	},
	{
		name: 'hidden shorthand title',
		source: '<input type="hidden" {title} />',
		expected: ['nativeTitle']
	},
	{
		name: 'file then text',
		source: '<input type="file" hidden /><input type="text" />',
		expected: ['nativeInput']
	},
	{
		name: 'hidden then checkbox',
		source: '<input type="hidden" /><input type="checkbox" />',
		expected: ['nativeCheckbox']
	},
	{
		name: 'text hidden attribute',
		source: '<input type="text" hidden />',
		expected: ['nativeInput']
	},
	{
		name: 'checkbox hidden class',
		source: '<input type="checkbox" class="hidden" />',
		expected: ['nativeCheckbox']
	},
	{
		name: 'checkbox inside titled link',
		source: '<a href="/" title="Help"><input type="checkbox" /></a>',
		expected: ['nativeCheckbox']
	},
	{
		name: 'checkbox beside titled iframe',
		source: '<iframe src="about:blank" title="Help"></iframe><input type="checkbox" />',
		expected: ['nativeCheckbox']
	},
	{
		name: 'text inside role=dialog',
		source: '<div role="dialog"><input type="text" /></div>',
		expected: ['nativeInput']
	},
	{
		name: 'role=dialog title',
		source: '<div role="dialog" title="Help"></div>',
		expected: ['nativeTitle']
	},
	{
		name: 'checkbox inside PromptSuggestion',
		source: '<PromptSuggestion title="Help"><input type="checkbox" /></PromptSuggestion>',
		expected: ['nativeCheckbox']
	},
	{
		name: 'span shorthand title',
		source: '<span {title}>Help</span>',
		expected: ['nativeTitle']
	},
	{
		name: 'Button shorthand title',
		source: '<Button {title}>Save</Button>',
		expected: ['nativeTitle']
	}
] as const;

const REAL_APP_FILE = 'src/lib/components/authenticated/authenticated-sidebar.svelte';

async function lintWithRealConfig(source: string, filename: string) {
	expect(existsSync(path.isAbsolute(filename) ? filename : path.join(repoRoot, filename))).toBe(
		true
	);
	await assertConfiguredAtError(filename);
	const results = await eslint.lintText(source, { filePath: filename });
	expect(results).toHaveLength(1);
	const result = results[0];
	expect(result.fatalErrorCount).toBe(0);
	expect(result.messages.some((message) => message.fatal)).toBe(false);
	expect(result.messages.some((message) => message.ruleId == null)).toBe(false);
	const local = result.messages.filter(
		(message) => message.ruleId === 'local/prefer-shadcn-primitives'
	);
	const otherErrors = result.messages.filter(
		(message) => message.severity === 2 && message.ruleId !== 'local/prefer-shadcn-primitives'
	);
	return { result, local, otherErrors };
}

function expectLocalOnly(
	outcome: Awaited<ReturnType<typeof lintWithRealConfig>>,
	messageId: keyof typeof EXPECTED_MESSAGES
) {
	expect(outcome.otherErrors).toEqual([]);
	expect(outcome.local).toHaveLength(1);
	expect(outcome.local[0].severity).toBe(2);
	expect(outcome.local[0].messageId).toBe(messageId);
	expect(outcome.local[0].message).toBe(EXPECTED_MESSAGES[messageId]);
	expect(outcome.result.errorCount).toBe(1);
}

function expectClean(outcome: Awaited<ReturnType<typeof lintWithRealConfig>>) {
	expect(outcome.local).toEqual([]);
	expect(outcome.otherErrors).toEqual([]);
	expect(outcome.result.errorCount).toBe(0);
}

function typeSyntaxes(type: string): Array<[string, string]> {
	return [
		['double', `<input type="${type}" />`],
		['single', `<input type='${type}' />`],
		['unquoted', `<input type=${type} />`],
		['mustache', `<input type={'${type}'} />`],
		['uppercase', `<input type="${type.toUpperCase()}" />`],
		['multiline', `<input\n\ttype="${type}"\n/>`]
	];
}

describe('prefer-shadcn-primitives', () => {
	it('flags a native button', () => {
		const reports = lint('<button type="button">Save</button>');
		expect(reports.map((r) => r.messageId)).toEqual(['nativeButton']);
	});

	it('allows a bits-ui child-host button with a spread', () => {
		const reports = lint(
			'{#snippet child({ props })}<button type="button" {...props}>Go</button>{/snippet}'
		);
		expect(reports).toHaveLength(0);
	});

	it('allows shadcn Button', () => {
		const reports = lint('<Button type="button">Save</Button>');
		expect(reports).toHaveLength(0);
	});

	it('flags a native dialog', () => {
		const reports = lint('<dialog>Hello</dialog>');
		expect(reports.map((r) => r.messageId)).toEqual(['nativeDialog']);
	});

	it('flags an HTML title tooltip', () => {
		const reports = lint('<span title={label}>{label}</span>');
		expect(reports.map((r) => r.messageId)).toEqual(['nativeTitle']);
	});

	it('flags title on Button', () => {
		const reports = lint('<Button title={label}>Save</Button>');
		expect(reports.map((r) => r.messageId)).toEqual(['nativeTitle']);
	});

	it('allows iframe title as the accessible name', () => {
		const reports = lint('<iframe title={name} src={url}></iframe>');
		expect(reports).toHaveLength(0);
	});

	it('allows markdown link title', () => {
		const reports = lint('<a href={href} title={token.title}>{label}</a>');
		expect(reports).toHaveLength(0);
	});

	it('allows SEOHead title as a component prop', () => {
		const reports = lint('<SEOHead title={pageTitle} />');
		expect(reports).toHaveLength(0);
	});

	it('skips shadcn ui wrappers', () => {
		const reports = lint(
			'<button type="button">Save</button>',
			'src/lib/components/ui/button/button.svelte'
		);
		expect(reports).toHaveLength(0);
	});

	it('skips the obfuscated email control', () => {
		const reports = lint(
			'<button type="button">a@b.c</button>',
			'src/lib/components/obfuscated-email.svelte'
		);
		expect(reports).toHaveLength(0);
	});
});

describe('message contracts', () => {
	it.each(Object.entries(EXPECTED_MESSAGES))(
		'%s matches the independently authored contract',
		(messageId, expected) => {
			expect(rule.meta.messages[messageId as keyof typeof EXPECTED_MESSAGES]).toBe(expected);
		}
	);

	it('checkbox names Checkbox and does not start as Input', () => {
		const text = rule.meta.messages.nativeCheckbox;
		expect(text.startsWith('Use shadcn Checkbox from $lib/components/ui/checkbox')).toBe(true);
		expect(text.startsWith('Use shadcn Input ')).toBe(false);
		expect(text).toBe(EXPECTED_MESSAGES.nativeCheckbox);
	});
});

describe('canonical primitives on app paths', () => {
	it.each(PRIMITIVE_CASES)('$key reports $messageId', ({ source, messageId }) => {
		expect(ids(lint(source))).toEqual([messageId]);
	});
});

describe('email path policy', () => {
	it('future email templates are absent', () => {
		expect(existsSync(path.join(repoRoot, 'src/lib/emails/templates/NewPromoEmail.svelte'))).toBe(
			false
		);
		expect(existsSync(path.join(repoRoot, 'src/lib/emails/future/deep/NewPromoEmail.svelte'))).toBe(
			false
		);
	});

	it.each(
		EMAIL_PATHS.flatMap((file) =>
			PRIMITIVE_CASES.flatMap((primitive) =>
				filenameVariants(file).map((filename) => ({
					filename,
					key: primitive.key,
					source: primitive.source
				}))
			)
		)
	)('allows $key at $filename', ({ source, filename }) => {
		expect(lint(source, filename)).toEqual([]);
	});

	it.each(
		PRIMITIVE_CASES.flatMap((primitive) =>
			filenameVariants('src/lib/emails/templates/VerificationEmail.svelte').map((filename) => ({
				filename,
				key: primitive.key,
				source: primitive.source
			}))
		)
	)('allows $key on existing VerificationEmail as $filename', ({ source, filename }) => {
		expect(lint(source, filename)).toEqual([]);
	});
});

describe('settings and lookalikes stay gated', () => {
	it.each(
		APP_GATED_PATHS.flatMap((file) =>
			PRIMITIVE_CASES.map((primitive) => ({
				file,
				key: primitive.key,
				source: primitive.source,
				messageId: primitive.messageId
			}))
		)
	)('$key at $file', ({ source, file, messageId }) => {
		expect(ids(lint(source, file))).toEqual([messageId]);
		expect(ids(lint(source, path.join(repoRoot, file)))).toEqual([messageId]);
	});
});

describe('other documented path exemptions', () => {
	it.each(
		EXEMPT_PATH_CASES.flatMap((file) =>
			PRIMITIVE_CASES.flatMap((primitive) =>
				filenameVariants(file).map((filename) => ({
					filename,
					key: primitive.key,
					source: primitive.source
				}))
			)
		)
	)('allows $key at $filename', ({ source, filename }) => {
		expect(lint(source, filename)).toEqual([]);
	});
});

describe('input literal syntax', () => {
	it.each(typeSyntaxes('checkbox'))('checkbox %s', (_label, source) => {
		expect(ids(lint(source))).toEqual(['nativeCheckbox']);
	});

	it.each(
		TEXT_LIKE_TYPES.flatMap((type) =>
			typeSyntaxes(type).map(([label, source]) => [type, label, source])
		)
	)('%s %s', (_type, _label, source) => {
		expect(ids(lint(source))).toEqual(['nativeInput']);
	});
});

describe('default text versus unknown', () => {
	it.each([
		'<input />',
		'<input type="" />',
		`<input type={''} />`,
		'<input type />',
		'<input {...props} />'
	])('%s is nativeInput', (source) => {
		expect(ids(lint(source))).toEqual(['nativeInput']);
	});

	it.each(['<input type={kind} />', '<input {type} />'])(
		'%s has no input-kind report',
		(source) => {
			expect(lint(source)).toEqual([]);
		}
	);
});

describe('unknown still has title', () => {
	it('reports title on unresolved type', () => {
		expect(ids(lint('<input type={kind} title="Help" />'))).toEqual(['nativeTitle']);
	});

	it('reports shorthand title with shorthand type', () => {
		expect(ids(lint('<input {type} {title} />'))).toEqual(['nativeTitle']);
	});
});

describe('host spread is Identifier props only', () => {
	it.each(['{...rest}', '{...{}}', '{...slot.props}', '{...Props}'])(
		'%s does not waive nativeButton',
		(spread) => {
			expect(ids(lint(`<button type="button" ${spread}>Save</button>`))).toEqual(['nativeButton']);
		}
	);

	it('keeps {...props} clean either attribute order', () => {
		expect(
			lint('{#snippet child({ props })}<button type="button" {...props}>Go</button>{/snippet}')
		).toEqual([]);
		expect(
			lint('{#snippet child({ props })}<button {...props} type="button">Go</button>{/snippet}')
		).toEqual([]);
	});
});

describe('explicit and shorthand titles', () => {
	it('flags shorthand title on span', () => {
		expect(ids(lint('<span {title}>Help</span>'))).toEqual(['nativeTitle']);
	});

	it('flags shorthand title on Button', () => {
		expect(ids(lint('<Button {title}>Save</Button>'))).toEqual(['nativeTitle']);
	});
});

describe('components use primitives', () => {
	it.each([
		'<Button>Save</Button>',
		'<Checkbox />',
		'<Input type="email" />',
		'<Textarea />',
		'<Select.Root></Select.Root>',
		'<Dialog.Root></Dialog.Root>',
		'<Tooltip.Root><Tooltip.Trigger>Hi</Tooltip.Trigger><Tooltip.Content>Tip</Tooltip.Content></Tooltip.Root>'
	])('%s is clean', (source) => {
		expect(lint(source)).toEqual([]);
	});
});

describe('file and hidden types stay allowed', () => {
	it.each([
		'<input type="file" />',
		'<input type="file" hidden />',
		'<input type="file" multiple accept=".png" hidden aria-hidden="true" tabindex="-1" />',
		'<input type="hidden" />',
		`<input type={'file'} />`,
		'<input type="FILE" />',
		'<input type="file" {...props} />',
		'<input {...props} type="file" />',
		'<input type="hidden" {...props} />',
		`<input type={'hidden'} />`,
		'<input type="HIDDEN" />',
		'<input {...props} type="hidden" />'
	])('%s', (source) => {
		expect(lint(source)).toEqual([]);
	});
});

describe('non-dialog overlay stays allowed', () => {
	it.each(['<div role="dialog"></div>', '<section role="dialog"></section>'])('%s', (source) => {
		expect(lint(source)).toEqual([]);
	});
});

describe('component title props stay allowed', () => {
	it.each([
		'<SEOHead title={pageTitle} />',
		'<SEOHead {title} />',
		'<AvatarHeading title={name} />',
		'<AvatarHeading {title} />',
		'<PromptSuggestion title={text} />',
		'<PromptSuggestion {title} />',
		'<DropdownMenu.Item title={label} />',
		'<DropdownMenu.Item {title} />'
	])('%s', (source) => {
		expect(lint(source)).toEqual([]);
	});
});

describe('native title whitelist stays narrow', () => {
	it('allows iframe and link shorthand title', () => {
		expect(lint('<iframe {title} src="about:blank"></iframe>')).toEqual([]);
		expect(lint('<a href="/" {title}>Help</a>')).toEqual([]);
	});

	it('still flags a span title next to a titled link', () => {
		expect(
			sortedIds(lint('<a href="/" title="Help"><span title="Details">Details</span></a>'))
		).toEqual(['nativeTitle']);
	});
});

describe('deferred type categories are not guessed', () => {
	it.each(['radio', 'range', 'color'])('type=%s has no input-kind report', (type) => {
		expect(lint(`<input type="${type}" />`)).toEqual([]);
	});

	it('dynamic type has no input-kind report', () => {
		expect(lint('<input type={kind} />')).toEqual([]);
	});

	it.each(['radio', 'range', 'color'])('type=%s still reports native title', (type) => {
		expect(ids(lint(`<input type="${type}" title="Help" />`))).toEqual(['nativeTitle']);
	});
});

describe('checkbox is not Switch inference', () => {
	it('checkbox with role=switch is still nativeCheckbox', () => {
		expect(ids(lint('<input type="checkbox" role="switch" />'))).toEqual(['nativeCheckbox']);
	});

	it('non-input role=switch is not a primitive diagnostic', () => {
		expect(lint('<div role="switch"></div>')).toEqual([]);
	});
});

describe('text-like spread orders', () => {
	it.each(
		TEXT_LIKE_TYPES.flatMap((type) => [
			[`<input type="${type}" {...props} />`, type, 'after'],
			[`<input {...props} type="${type}" />`, type, 'before']
		])
	)('%s', (source) => {
		expect(ids(lint(source))).toEqual(['nativeInput']);
	});
});

describe('exception non-transfer on app paths', () => {
	it.each(SCOPED_CASES)('$name', ({ source, expected }) => {
		expect(sortedIds(lint(source))).toEqual([...expected].sort());
	});
});

describe('exception non-transfer on exempt paths', () => {
	it.each(
		SCOPED_CASES.flatMap((scoped) =>
			ALL_EXEMPT_PATHS.flatMap((file) =>
				filenameVariants(file).map((filename) => ({
					name: scoped.name,
					source: scoped.source,
					filename
				}))
			)
		)
	)('$name at $filename', ({ source, filename }) => {
		expect(lint(source, filename)).toEqual([]);
	});
});

describe('real ESLint configuration', () => {
	const appFiles = [
		'src/lib/components/authenticated/authenticated-sidebar.svelte',
		'src/routes/[[lang]]/app/settings/email-settings.svelte',
		'src/routes/[[lang]]/admin/settings/add-email-dialog.svelte'
	];
	const emailFiles = [
		'src/lib/emails/templates/VerificationEmail.svelte',
		'src/lib/emails/components/layout/EmailHeader.svelte'
	];

	it.each(PRIMITIVE_CASES.flatMap((primitive) => appFiles.map((file) => ({ ...primitive, file }))))(
		'$key at $file',
		async ({ source, file, messageId }) => {
			expectLocalOnly(await lintWithRealConfig(source, file), messageId);
		},
		60_000
	);

	it.each(
		PRIMITIVE_CASES.flatMap((primitive) =>
			emailFiles.flatMap((file) =>
				[file, path.join(repoRoot, file)].map((filename) => ({
					...primitive,
					filename
				}))
			)
		)
	)(
		'$key at email $filename',
		async ({ source, filename }) => {
			expectClean(await lintWithRealConfig(source, filename));
		},
		60_000
	);

	it('future email filenames still select the rule at error', async () => {
		for (const file of [
			'src/lib/emails/templates/NewPromoEmail.svelte',
			'src/lib/emails/future/deep/NewPromoEmail.svelte'
		]) {
			await assertConfiguredAtError(file);
			await assertConfiguredAtError(path.join(repoRoot, file));
		}
	}, 60_000);

	it.each([
		[
			'empty object spread',
			'<script>const rest = {};</script>\n<button type="button" {...{}}>Save</button>',
			['nativeButton']
		],
		[
			'rest spread',
			'<script>const rest = {};</script>\n<button type="button" {...rest}>Save</button>',
			['nativeButton']
		],
		[
			'span shorthand title',
			'<script>const title = "Help";</script>\n<span {title}>Help</span>',
			['nativeTitle']
		],
		[
			'Button explicit title',
			'<script>import { Button } from "$lib/components/ui/button";</script>\n<Button title="Help">Save</Button>',
			['nativeTitle']
		],
		[
			'Button shorthand title',
			'<script>import { Button } from "$lib/components/ui/button"; const title = "Help";</script>\n<Button {title}>Save</Button>',
			['nativeTitle']
		],
		['default input', '<input />', ['nativeInput']],
		[
			'host plus title',
			'<script>const props = {};</script>\n<button type="button" {...props} title="Help">Save</button>',
			['nativeTitle']
		],
		[
			'dialog props',
			'<script>const props = {};</script>\n<dialog {...props}>Help</dialog>',
			['nativeDialog']
		],
		[
			'checkbox props plus title',
			'<script>const props = {};</script>\n<input type="checkbox" {...props} title="Help" />',
			['nativeCheckbox', 'nativeTitle']
		],
		[
			'select props plus title',
			'<script>const props = {};</script>\n<select {...props} title="Help"></select>',
			['nativeSelect', 'nativeTitle']
		],
		[
			'file hidden plus title',
			'<script>const props = {};</script>\n<input type="file" hidden {...props} title="Help" />',
			['nativeTitle']
		],
		[
			'hidden plus title',
			'<script>const title = "Help";</script>\n<input type="hidden" {title} />',
			['nativeTitle']
		]
	] as const)(
		'%s',
		async (_name, source, messageIds) => {
			const outcome = await lintWithRealConfig(source, REAL_APP_FILE);
			expect(outcome.otherErrors).toEqual([]);
			expect(outcome.local.map((message) => message.messageId).sort()).toEqual(
				[...messageIds].sort()
			);
			expect(outcome.local.every((message) => message.severity === 2)).toBe(true);
			for (const message of outcome.local) {
				expect(message.message).toBe(
					EXPECTED_MESSAGES[message.messageId as keyof typeof EXPECTED_MESSAGES]
				);
			}
			expect(outcome.result.errorCount).toBe(messageIds.length);
		},
		60_000
	);

	it('checkbox mustache still reports nativeCheckbox under the production parser', async () => {
		const outcome = await lintWithRealConfig(`<input type={'checkbox'} />`, REAL_APP_FILE);
		expect(outcome.local.map((message) => message.messageId)).toEqual(['nativeCheckbox']);
		expect(outcome.local[0]?.message).toBe(EXPECTED_MESSAGES.nativeCheckbox);
		expect(
			outcome.otherErrors.every((message) => message.ruleId === 'svelte/no-useless-mustaches')
		).toBe(true);
	}, 60_000);

	it('keeps production hosts, file picker, overlay, and component titles clean', async () => {
		const samples = [
			{
				source: '{#snippet child({ props })}<button type="button" {...props}>Go</button>{/snippet}',
				file: REAL_APP_FILE
			},
			{
				source: '<input type="file" hidden />',
				file: 'src/lib/chat/ui/ChatInput.svelte'
			},
			{
				source: '<input type="hidden" />',
				file: 'src/lib/chat/ui/ChatInput.svelte'
			},
			{
				source: '<div role="dialog"></div>',
				file: 'src/lib/components/customer-support/screenshot-editor/ScreenshotEditor.svelte'
			},
			{
				source:
					'<script>const name = "n"; const url = "about:blank";</script>\n<iframe title={name} src={url}></iframe>',
				file: REAL_APP_FILE
			},
			{
				source: '<a href="https://example.com/" title="Help">Help</a>',
				file: REAL_APP_FILE
			},
			{
				source:
					'<script>import SEOHead from "$lib/components/SEOHead.svelte"; const title = "Help";</script>\n<SEOHead {title} />',
				file: REAL_APP_FILE
			},
			{
				source:
					'<script>import AvatarHeading from "$lib/components/customer-support/avatar-heading.svelte"; const title = "Help";</script>\n<AvatarHeading {title} />',
				file: 'src/lib/components/customer-support/threads-overview.svelte'
			},
			{
				source:
					'<script>import { PromptSuggestion } from "$lib/components/prompt-kit/prompt-suggestion"; const title = "Help";</script>\n<PromptSuggestion {title} />',
				file: 'src/lib/chat/ui/ChatInput.svelte'
			},
			{
				source:
					'<script>import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js"; const title = "Help";</script>\n<DropdownMenu.Item {title} />',
				file: 'src/lib/components/nav-user.svelte'
			}
		];
		for (const { source, file } of samples) {
			expectClean(await lintWithRealConfig(source, file));
		}
	}, 60_000);
});
