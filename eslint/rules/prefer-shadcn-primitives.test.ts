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
	expect(result.messages.some((message) => message.ruleId == null && message.fatal)).toBe(false);
	const local = result.messages.filter(
		(message) => message.ruleId === 'local/prefer-shadcn-primitives'
	);
	return { result, local };
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
	it.each(PRIMITIVE_CASES)('$key names $importPath', ({ messageId, importPath }) => {
		const text = rule.meta.messages[messageId];
		expect(text).toBeTruthy();
		expect(text).toContain(importPath);
	});

	it('does not tell checkbox authors to use Input', () => {
		expect(rule.meta.messages.nativeCheckbox).not.toContain('$lib/components/ui/input');
		expect(rule.meta.messages.nativeCheckbox).toContain('$lib/components/ui/checkbox');
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
					file,
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
					file,
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
	it.each([
		['double', '<input type="checkbox" />'],
		['single', "<input type='checkbox' />"],
		['unquoted', '<input type=checkbox />'],
		['mustache', `<input type={'checkbox'} />`],
		['uppercase', '<input type="CHECKBOX" />'],
		['multiline', '<input\n\ttype="checkbox"\n/>']
	])('checkbox %s', (_label, source) => {
		expect(ids(lint(source))).toEqual(['nativeCheckbox']);
	});

	it.each([
		['double', '<input type="email" />'],
		['single', "<input type='email' />"],
		['unquoted', '<input type=email />'],
		['mustache', `<input type={"email"} />`],
		['uppercase', '<input type="EMAIL" />']
	])('email %s', (_label, source) => {
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
		'<input type="hidden" {...props} />'
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

	it('deferred types still report native title', () => {
		expect(ids(lint('<input type="radio" title="Help" />'))).toEqual(['nativeTitle']);
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

describe('exception non-transfer', () => {
	it.each([
		['<button type="button" {...props} title="Help">Save</button>', ['nativeTitle']],
		['<button type="button" {...props} {title}>Save</button>', ['nativeTitle']],
		['<button type="button" {...rest} title="Help">Save</button>', ['nativeButton', 'nativeTitle']],
		['<dialog {...props}>Help</dialog>', ['nativeDialog']],
		['<dialog {...props} title="Help">Help</dialog>', ['nativeDialog', 'nativeTitle']],
		['<input type="checkbox" {...props} />', ['nativeCheckbox']],
		['<input {...props} type="checkbox" />', ['nativeCheckbox']],
		['<input type="checkbox" {...props} title="Help" />', ['nativeCheckbox', 'nativeTitle']],
		['<select {...props}></select>', ['nativeSelect']],
		['<textarea {...props}></textarea>', ['nativeTextarea']],
		['<select {...props} title="Help"></select>', ['nativeSelect', 'nativeTitle']],
		['<textarea {...props} title="Help"></textarea>', ['nativeTextarea', 'nativeTitle']],
		['<input type="text" {...props} />', ['nativeInput']],
		['<input {...props} type="text" />', ['nativeInput']],
		['<input type="email" {...props} title="Help" />', ['nativeInput', 'nativeTitle']],
		['<input type="file" hidden {...props} title="Help" />', ['nativeTitle']],
		['<input type="hidden" {title} />', ['nativeTitle']],
		['<input type="file" hidden /><input type="text" />', ['nativeInput']],
		['<input type="hidden" /><input type="checkbox" />', ['nativeCheckbox']],
		['<input type="text" hidden />', ['nativeInput']],
		['<input type="checkbox" class="hidden" />', ['nativeCheckbox']],
		['<a href="/" title="Help"><input type="checkbox" /></a>', ['nativeCheckbox']],
		[
			'<iframe src="about:blank" title="Help"></iframe><input type="checkbox" />',
			['nativeCheckbox']
		],
		['<div role="dialog"><input type="text" /></div>', ['nativeInput']],
		['<div role="dialog" title="Help"></div>', ['nativeTitle']],
		[
			'<PromptSuggestion title="Help"><input type="checkbox" /></PromptSuggestion>',
			['nativeCheckbox']
		]
	] as const)('%s', (source, expected) => {
		expect(sortedIds(lint(source))).toEqual([...expected].sort());
	});

	it.each([...EMAIL_PATHS, ...EXEMPT_PATH_CASES])(
		'exempt path skips multi-diagnostic samples at %s',
		(file) => {
			expect(lint('<button type="button" {...rest} title="Help">Save</button>', file)).toEqual([]);
			expect(lint('<span {title}>Help</span>', file)).toEqual([]);
			expect(lint('<input type="checkbox" />', file)).toEqual([]);
		}
	);
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
		async ({ source, file, messageId, importPath }) => {
			const { local } = await lintWithRealConfig(source, file);
			expect(local).toHaveLength(1);
			expect(local[0].severity).toBe(2);
			expect(local[0].messageId).toBe(messageId);
			expect(local[0].message).toContain(importPath);
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
			const { local, result } = await lintWithRealConfig(source, filename);
			expect(local).toEqual([]);
			expect(result.errorCount).toBe(0);
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

	it('keeps production hosts, file picker, overlay, and component titles clean', async () => {
		const samples = [
			{
				source: '{#snippet child({ props })}<button type="button" {...props}>Go</button>{/snippet}',
				file: 'src/lib/components/authenticated/authenticated-sidebar.svelte'
			},
			{
				source: '<input type="file" hidden />',
				file: 'src/lib/chat/ui/ChatInput.svelte'
			},
			{
				source: '<div role="dialog"></div>',
				file: 'src/lib/components/customer-support/screenshot-editor/ScreenshotEditor.svelte'
			},
			{
				source: '<iframe title={name} src={url}></iframe>',
				file: 'src/lib/components/authenticated/authenticated-sidebar.svelte'
			},
			{
				source: '<a href="/" title="Help">Help</a>',
				file: 'src/lib/components/authenticated/authenticated-sidebar.svelte'
			},
			{
				source: '<SEOHead title={pageTitle} />',
				file: 'src/lib/components/authenticated/authenticated-sidebar.svelte'
			},
			{
				source: '<AvatarHeading title={name} />',
				file: 'src/lib/components/customer-support/threads-overview.svelte'
			},
			{
				source: '<PromptSuggestion title={text} />',
				file: 'src/lib/chat/ui/ChatInput.svelte'
			},
			{
				source: '<DropdownMenu.Item title={label} />',
				file: 'src/lib/components/nav-user.svelte'
			}
		];
		for (const { source, file } of samples) {
			const { local, result } = await lintWithRealConfig(source, file);
			expect(local, source).toEqual([]);
			expect(result.fatalErrorCount, source).toBe(0);
		}
	}, 60_000);
});
