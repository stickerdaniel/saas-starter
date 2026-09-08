import { domainToASCII } from 'node:url';
import { parseArgs } from 'node:util';
import packageJson from '../package.json' with { type: 'json' };

export const CLI_VERSION = packageJson.version;
export const DEFAULT_TEMPLATE_SHA = 'cf7b588419f2d4373a5380384cc6c8f80198b80c';

export const HELP_TEXT = `create-saas-starter ${CLI_VERSION}

Usage:
  create-saas-starter [directory] [options]

Options:
  --slug <slug>             Project worker slug
  --repo <owner/name>       Branded GitHub repository
  --brand <name>            Brand display name
  --company <name>          Legal company name
  --operator <name>         Legal operator name
  --address <address>       Legal address
  --email <email>           Legal contact email
  --ref <ref>               GitHub revision to resolve once
  --yes                     Disable interactive prompts
  --trust-template          Trust the resolved template revision
  --skip-install            Run setup but leave dependencies uninstalled
  --dry-run                 Validate locally without side effects
  -h, --help                Show help
  --version                 Show version

The source is fixed to stickerdaniel/saas-starter. Existing paths are never overwritten.
--yes does not imply --trust-template.`;

export class UsageError extends Error {}

export interface CliOptions {
	directory?: string;
	slug?: string;
	repo?: string;
	brand?: string;
	company?: string;
	operator?: string;
	address?: string;
	email?: string;
	ref?: string;
	yes: boolean;
	trustTemplate: boolean;
	skipInstall: boolean;
	dryRun: boolean;
	help: boolean;
	version: boolean;
}

function normalizedString(value: string | undefined, option: string): string | undefined {
	if (value === undefined) return undefined;
	const normalized = value.trim();
	if (normalized === '') throw new UsageError(`--${option} must not be empty.`);
	return normalized;
}

export function parseCliOptions(args: string[]): CliOptions {
	let parsed: ReturnType<typeof parseArgs>;
	try {
		parsed = parseArgs({
			args,
			strict: true,
			allowPositionals: true,
			tokens: true,
			options: {
				slug: { type: 'string' },
				repo: { type: 'string' },
				brand: { type: 'string' },
				company: { type: 'string' },
				operator: { type: 'string' },
				address: { type: 'string' },
				email: { type: 'string' },
				ref: { type: 'string' },
				yes: { type: 'boolean' },
				'trust-template': { type: 'boolean' },
				'skip-install': { type: 'boolean' },
				'dry-run': { type: 'boolean' },
				help: { type: 'boolean', short: 'h' },
				version: { type: 'boolean' }
			}
		});
	} catch (error) {
		throw new UsageError(error instanceof Error ? error.message : String(error));
	}

	if (parsed.positionals.length > 1) {
		throw new UsageError('Only one target directory may be provided.');
	}

	const seen = new Set<string>();
	for (const token of parsed.tokens ?? []) {
		if (token.kind !== 'option') continue;
		const name = token.name === 'h' ? 'help' : token.name;
		if (seen.has(name)) throw new UsageError(`--${name} may only be provided once.`);
		seen.add(name);
	}

	const values = parsed.values;
	return {
		directory: normalizedString(parsed.positionals[0], 'directory'),
		slug: normalizedString(values.slug as string | undefined, 'slug'),
		repo: normalizedString(values.repo as string | undefined, 'repo'),
		brand: normalizedString(values.brand as string | undefined, 'brand'),
		company: normalizedString(values.company as string | undefined, 'company'),
		operator: normalizedString(values.operator as string | undefined, 'operator'),
		address: normalizedString(values.address as string | undefined, 'address'),
		email: normalizedString(values.email as string | undefined, 'email'),
		ref: normalizedString(values.ref as string | undefined, 'ref'),
		yes: values.yes === true,
		trustTemplate: values['trust-template'] === true,
		skipInstall: values['skip-install'] === true,
		dryRun: values['dry-run'] === true,
		help: values.help === true,
		version: values.version === true
	};
}

export function isValidSlug(value: string): boolean {
	return value.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value);
}

function hasReservedWindowsDeviceBasename(value: string): boolean {
	const repository = /^[A-Za-z0-9-]+\/([A-Za-z0-9._-]+)$/.exec(value)?.[1];
	return repository ? /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(repository) : false;
}

export function isValidRepository(value: string): boolean {
	const match = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(value);
	if (!match) return false;
	const owner = match[1]!;
	const repository = match[2]!;
	return (
		owner.length <= 39 &&
		repository.length <= 100 &&
		!owner.startsWith('-') &&
		!owner.endsWith('-') &&
		!owner.includes('--') &&
		!['.', '..'].includes(repository) &&
		!repository.endsWith('.') &&
		!repository.toLowerCase().endsWith('.git') &&
		!hasReservedWindowsDeviceBasename(value)
	);
}

function isSingleLine(value: string): boolean {
	return (
		value.trim() !== '' && !value.includes('\r') && !value.includes('\n') && !value.includes('\0')
	);
}

export function isValidContactEmail(value: string): boolean {
	const at = value.indexOf('@');
	if (at <= 0 || at !== value.lastIndexOf('@')) return false;
	const user = value.slice(0, at);
	if (
		Buffer.byteLength(user, 'utf8') > 64 ||
		!/^([\p{L}\p{N}\p{M}._+'-])+$/u.test(user) ||
		user.startsWith('.') ||
		user.endsWith('.') ||
		user.includes('..')
	) {
		return false;
	}
	const labels = value.slice(at + 1).split('.');
	if (labels.length < 2 || labels.some((label) => label === '')) return false;
	const asciiLabels = labels.map(domainToASCII);
	if (
		asciiLabels.some(
			(label) =>
				label === '' ||
				label.length > 63 ||
				!/^[A-Za-z0-9-]+$/.test(label) ||
				label.startsWith('-') ||
				label.endsWith('-')
		)
	) {
		return false;
	}
	const asciiDomain = asciiLabels.join('.');
	return (
		asciiDomain.length <= 253 && Buffer.byteLength(user, 'utf8') + 1 + asciiDomain.length <= 254
	);
}

type ProvidedValues = Pick<
	CliOptions,
	'slug' | 'repo' | 'brand' | 'company' | 'operator' | 'address' | 'email' | 'ref'
>;

export function validateProvidedValues(options: ProvidedValues): void {
	if (options.slug !== undefined && !isValidSlug(options.slug)) {
		throw new UsageError('--slug must use 1-63 lowercase letters, numbers, or inner hyphens.');
	}
	if (options.repo !== undefined && !isValidRepository(options.repo)) {
		throw new UsageError('--repo must use a portable GitHub owner/name value.');
	}
	for (const [name, value] of [
		['brand', options.brand],
		['operator', options.operator]
	] as const) {
		if (value !== undefined && !isSingleLine(value)) {
			throw new UsageError(`--${name} must be a non-empty single-line value.`);
		}
	}
	for (const [name, value] of [
		['company', options.company],
		['address', options.address]
	] as const) {
		if (value !== undefined && (value.trim() === '' || value.includes('\0'))) {
			throw new UsageError(`--${name} must be a non-empty value.`);
		}
	}
	if (options.email !== undefined && !isValidContactEmail(options.email)) {
		throw new UsageError('--email must use the supported user@domain.tld format.');
	}
	if (options.ref !== undefined && (!isSingleLine(options.ref) || options.ref.length > 256)) {
		throw new UsageError('--ref must be a non-empty single-line GitHub revision.');
	}
}

export function deriveSlug(directory: string): string | undefined {
	const basename = directory
		.replace(/[\\/]+$/, '')
		.split(/[\\/]/)
		.at(-1);
	return basename && isValidSlug(basename) ? basename : undefined;
}
