import path from 'node:path';
import { domainToASCII } from 'node:url';
import { parseArgs } from 'node:util';
import packageJson from '../package.json' with { type: 'json' };

export const CLI_VERSION = packageJson.version;
export const DEFAULT_TEMPLATE_SHA = '8a2c3bd982e0c6aac2bdda7821aed704a8034af3';

export const HELP_TEXT = `create-saas-starter ${CLI_VERSION}

Usage:
  create-saas-starter [directory] [options]

Options:
  --slug <slug>             Project worker slug
  --repo <owner/name>       Branded GitHub repository
  --brand <name>            Brand display name
  --company <name>          Legal company name
  --operator <name>         Legal operator name
  --street <street>         Legal street address
  --postal-code <code>      Legal postal code
  --city <city>             Legal city
  --country <code>          Legal country as two uppercase letters, such as US
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
	street?: string;
	postalCode?: string;
	city?: string;
	country?: string;
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

function normalizedMultilineString(value: string | undefined, option: string): string | undefined {
	const normalized = normalizedString(value, option);
	return normalized === undefined ? undefined : normalizeMultilineText(normalized);
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
				street: { type: 'string' },
				'postal-code': { type: 'string' },
				city: { type: 'string' },
				country: { type: 'string' },
				// Parsed only to reject it with the replacement options instead of a generic error.
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
	if (values.address !== undefined) {
		throw new UsageError(
			'--address was replaced by --street, --postal-code, --city, and --country.'
		);
	}
	return {
		directory: normalizedString(parsed.positionals[0], 'directory'),
		slug: normalizedString(values.slug as string | undefined, 'slug'),
		repo: normalizedString(values.repo as string | undefined, 'repo'),
		brand: normalizedString(values.brand as string | undefined, 'brand'),
		company: normalizedMultilineString(values.company as string | undefined, 'company'),
		operator: normalizedString(values.operator as string | undefined, 'operator'),
		street: normalizedString(values.street as string | undefined, 'street'),
		postalCode: normalizedString(values['postal-code'] as string | undefined, 'postal-code'),
		city: normalizedString(values.city as string | undefined, 'city'),
		country: normalizedString(values.country as string | undefined, 'country'),
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

export function isReservedWindowsDeviceName(value: string): boolean {
	return /^(?:con|prn|aux|nul|com(?:[1-9]|[¹²³])|lpt(?:[1-9]|[¹²³]))(?:\.|$)/i.test(value);
}

function hasReservedWindowsDeviceBasename(value: string): boolean {
	const repository = /^[A-Za-z0-9-]+\/([A-Za-z0-9._-]+)$/.exec(value)?.[1];
	return repository ? isReservedWindowsDeviceName(repository) : false;
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

function isBidiControl(code: number): boolean {
	return (
		code === 0x061c ||
		code === 0x200e ||
		code === 0x200f ||
		(code >= 0x202a && code <= 0x202e) ||
		(code >= 0x2066 && code <= 0x2069)
	);
}

export function normalizeMultilineText(value: string): string {
	return value.replaceAll('\r\n', '\n');
}

export function hasUnsafeTextControl(value: string, allowLineFeeds = false): boolean {
	const normalized = allowLineFeeds ? normalizeMultilineText(value) : value;
	return [...normalized].some((character) => {
		const code = character.codePointAt(0)!;
		if (allowLineFeeds && code === 0x0a) return false;
		return (
			code <= 0x1f ||
			(code >= 0x7f && code <= 0x9f) ||
			code === 0x2028 ||
			code === 0x2029 ||
			isBidiControl(code)
		);
	});
}

function isSingleLine(value: string): boolean {
	return value.trim() !== '' && !hasUnsafeTextControl(value);
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
	| 'slug'
	| 'repo'
	| 'brand'
	| 'company'
	| 'operator'
	| 'street'
	| 'postalCode'
	| 'city'
	| 'country'
	| 'email'
	| 'ref'
>;

/** Matches template setup's country check: two uppercase letters, not ISO 3166-1 membership. */
export function isValidCountryCode(value: string): boolean {
	return /^[A-Z]{2}$/.test(value);
}

export function validateProvidedValues(options: ProvidedValues): void {
	if (options.slug !== undefined && !isValidSlug(options.slug)) {
		throw new UsageError('--slug must use 1-63 lowercase letters, numbers, or inner hyphens.');
	}
	if (options.repo !== undefined && !isValidRepository(options.repo)) {
		throw new UsageError('--repo must use a portable GitHub owner/name value.');
	}
	for (const [name, value] of [
		['brand', options.brand],
		['operator', options.operator],
		['street', options.street],
		['postal-code', options.postalCode],
		['city', options.city]
	] as const) {
		if (value !== undefined && !isSingleLine(value)) {
			throw new UsageError(`--${name} must be a non-empty single-line value.`);
		}
	}
	if (
		options.company !== undefined &&
		(options.company.trim() === '' || hasUnsafeTextControl(options.company, true))
	) {
		throw new UsageError('--company must be non-empty text without unsafe controls.');
	}
	if (options.country !== undefined && !isValidCountryCode(options.country)) {
		throw new UsageError('--country must be two uppercase letters, such as US or DE.');
	}
	if (options.email !== undefined && !isValidContactEmail(options.email)) {
		throw new UsageError('--email must use the supported user@domain.tld format.');
	}
	if (options.ref !== undefined && (!isSingleLine(options.ref) || options.ref.length > 256)) {
		throw new UsageError('--ref must be a non-empty single-line GitHub revision.');
	}
}

export function deriveSlug(
	directory: string,
	platform: NodeJS.Platform = process.platform
): string | undefined {
	const basename =
		platform === 'win32' ? path.win32.basename(directory) : path.posix.basename(directory);
	return basename && isValidSlug(basename) ? basename : undefined;
}
