import * as clack from '@clack/prompts';
import {
	deriveSlug,
	isValidContactEmail,
	isValidRepository,
	isValidSlug,
	type CliOptions,
	UsageError,
	validateProvidedValues
} from './options.js';

export class PromptCancelledError extends Error {}

export interface ResolvedOptions {
	directory: string;
	slug: string;
	repo: string;
	brand: string;
	company?: string;
	operator?: string;
	address?: string;
	email?: string;
	ref?: string;
	yes: boolean;
	trustTemplate: boolean;
	skipInstall: boolean;
	dryRun: boolean;
}

export interface PromptAdapter {
	text: typeof clack.text;
	confirm: typeof clack.confirm;
	isCancel: typeof clack.isCancel;
	cancel: typeof clack.cancel;
}

const defaultPrompts: PromptAdapter = {
	text: clack.text,
	confirm: clack.confirm,
	isCancel: clack.isCancel,
	cancel: clack.cancel
};

export function isNonInteractive(
	options: CliOptions,
	input: NodeJS.ReadStream = process.stdin,
	environment: NodeJS.ProcessEnv = process.env
): boolean {
	return (
		options.yes || !input.isTTY || (environment.CI !== undefined && environment.CI !== 'false')
	);
}

function required(value: string | symbol, prompts: PromptAdapter): string {
	if (prompts.isCancel(value)) {
		prompts.cancel('Scaffolding cancelled.');
		throw new PromptCancelledError('Scaffolding cancelled.');
	}
	const normalized = value.trim();
	if (normalized === '') throw new UsageError('A required prompt returned an empty value.');
	return normalized;
}

function optional(value: string | symbol, prompts: PromptAdapter): string | undefined {
	if (prompts.isCancel(value)) {
		prompts.cancel('Scaffolding cancelled.');
		throw new PromptCancelledError('Scaffolding cancelled.');
	}
	const normalized = value.trim();
	return normalized === '' ? undefined : normalized;
}

function hasLineBreakOrNull(value: string | undefined): boolean {
	return value?.includes('\r') || value?.includes('\n') || value?.includes('\0') || false;
}

async function promptText(
	prompts: PromptAdapter,
	signal: AbortSignal | undefined,
	message: string,
	options: {
		initialValue?: string;
		placeholder?: string;
		validate?: (value: string | undefined) => string | undefined;
	} = {}
): Promise<string> {
	return required(await prompts.text({ message, ...options, signal }), prompts);
}

async function promptOptional(
	prompts: PromptAdapter,
	signal: AbortSignal | undefined,
	message: string,
	value: string | undefined,
	validate?: (value: string | undefined) => string | undefined
): Promise<string | undefined> {
	if (value !== undefined) return value;
	return optional(
		await prompts.text({
			message,
			signal,
			placeholder: 'Leave blank to keep the template value',
			validate: (candidate) =>
				candidate === undefined || candidate.trim() === '' ? undefined : validate?.(candidate)
		}),
		prompts
	);
}

export async function resolveOptions(
	options: CliOptions,
	configuration: {
		interactive?: boolean;
		prompts?: PromptAdapter;
		signal?: AbortSignal;
	} = {}
): Promise<ResolvedOptions> {
	validateProvidedValues(options);
	const prompts = configuration.prompts ?? defaultPrompts;
	const signal = configuration.signal;
	const interactive = configuration.interactive ?? !isNonInteractive(options);

	if (!interactive) {
		if (!options.directory) throw new UsageError('A target directory is required without prompts.');
		if (!options.repo) throw new UsageError('--repo is required without prompts.');
		const slug = options.slug ?? deriveSlug(options.directory);
		if (!slug)
			throw new UsageError('--slug is required when it cannot be derived from the directory.');
		const resolved = {
			...options,
			directory: options.directory,
			repo: options.repo,
			slug,
			brand: options.brand ?? slug
		};
		validateProvidedValues(resolved);
		return resolved;
	}

	const directory =
		options.directory ??
		(await promptText(prompts, signal, 'Where should the project be created?', {
			placeholder: 'my-saas-app'
		}));
	const slug =
		options.slug ??
		(await promptText(prompts, signal, 'Project slug', {
			initialValue: deriveSlug(directory),
			validate: (value) =>
				isValidSlug(value ?? '')
					? undefined
					: 'Use 1-63 lowercase letters, numbers, or inner hyphens.'
		}));
	const repo =
		options.repo ??
		(await promptText(prompts, signal, 'GitHub repository for project branding (owner/name)', {
			validate: (value) =>
				isValidRepository(value ?? '') ? undefined : 'Use a portable GitHub owner/name value.'
		}));
	const brand =
		options.brand ??
		(await promptText(prompts, signal, 'Brand display name', {
			initialValue: slug,
			validate: (value) => (hasLineBreakOrNull(value) ? 'Use a single-line value.' : undefined)
		}));
	const singleLine = (value: string | undefined) =>
		hasLineBreakOrNull(value) ? 'Use a single-line value.' : undefined;
	const nonEmpty = (value: string | undefined) =>
		value?.includes('\0') ? 'The value must not contain a null character.' : undefined;
	const company = await promptOptional(
		prompts,
		signal,
		'Legal company name',
		options.company,
		nonEmpty
	);
	const operator = await promptOptional(
		prompts,
		signal,
		'Legal operator name',
		options.operator,
		singleLine
	);
	const address = await promptOptional(prompts, signal, 'Legal address', options.address, nonEmpty);
	const email = await promptOptional(
		prompts,
		signal,
		'Legal contact email',
		options.email,
		(value) =>
			isValidContactEmail(value ?? '') ? undefined : 'Use the supported user@domain.tld format.'
	);

	const resolved: ResolvedOptions = {
		...options,
		directory,
		slug,
		repo,
		brand,
		company,
		operator,
		address,
		email
	};
	validateProvidedValues(resolved);
	return resolved;
}

export async function confirmTemplateTrust(
	sha: string,
	interactive: boolean,
	alreadyTrusted: boolean,
	signal?: AbortSignal,
	prompts: PromptAdapter = defaultPrompts
): Promise<void> {
	if (alreadyTrusted) return;
	if (!interactive) {
		throw new UsageError('Template execution requires explicit --trust-template.');
	}
	const answer = await prompts.confirm({
		message: `Trust and execute github.com/stickerdaniel/saas-starter at commit ${sha}?`,
		signal,
		initialValue: false,
		active: 'Trust',
		inactive: 'Do not trust'
	});
	if (prompts.isCancel(answer)) {
		prompts.cancel('Scaffolding cancelled.');
		throw new PromptCancelledError('Scaffolding cancelled.');
	}
	if (!answer) throw new UsageError('Template trust was not granted.');
}
