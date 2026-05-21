/**
 * Template setup script — replaces project-specific placeholders after
 * generating a new repo from the GitHub template.
 *
 * Safe to re-run: prompts with current values as defaults.
 *
 * Usage:
 *   bun run setup
 *   bun run setup --slug my-app --repo owner/my-app --brand "My App"
 *
 * Non-interactive mode (piped stdin, CI, agents) requires --slug, --repo, --brand.
 * Identity fields (company, operator, address, email) preserve current legal.ts
 * values when no flag is given; pass --company/--operator/--address/--email to override.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createInterface, type Interface } from 'readline';
import { parseArgs } from 'util';

const ROOT = join(import.meta.dirname, '..');

const { values } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		slug: { type: 'string' },
		repo: { type: 'string' },
		brand: { type: 'string' },
		company: { type: 'string' },
		operator: { type: 'string' },
		address: { type: 'string' },
		email: { type: 'string' },
		help: { type: 'boolean', short: 'h', default: false }
	},
	strict: false,
	allowPositionals: false
});

if (values.help) {
	console.log(`Template Setup

Usage:
  bun run setup                                          (interactive)
  bun run setup --slug <s> --repo <owner/name> --brand <s> [--company <s>] [--operator <s>] [--address <s>] [--email <user@domain.tld>]

Flags:
  --slug      Project slug (lowercase, hyphens; matches ^[a-z0-9-]+$)
  --repo      GitHub repo in owner/name format
  --brand     Brand display name
  --company   Company name (legal entity)
  --operator  Operator name (person or org running the service)
  --address   Address used in Impressum and email footer
  --email     Contact email in user@domain.tld form
  -h, --help  Show this help

In non-interactive mode (piped stdin, CI), --slug, --repo, --brand are required.
Identity fields without flags preserve current legal.ts values.
In interactive mode, missing flags are prompted with current values as defaults.`);
	process.exit(0);
}

function normalizeFlag(v: unknown): string | undefined {
	if (typeof v !== 'string') return undefined;
	const t = v.trim();
	return t === '' ? undefined : t;
}
const slugFlag = normalizeFlag(values.slug);
const repoFlag = normalizeFlag(values.repo);
const brandFlag = normalizeFlag(values.brand);
const companyFlag = normalizeFlag(values.company);
const operatorFlag = normalizeFlag(values.operator);
const addressFlag = normalizeFlag(values.address);
const emailFlag = normalizeFlag(values.email);

const interactive = !!process.stdin.isTTY;
let rl: Interface | undefined;
function ensureReadline(): Interface {
	if (!rl) rl = createInterface({ input: process.stdin, output: process.stdout });
	return rl;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function read(rel: string): string {
	return readFileSync(join(ROOT, rel), 'utf-8');
}

function write(rel: string, content: string): void {
	writeFileSync(join(ROOT, rel), content, 'utf-8');
}

function replace(rel: string, pairs: Array<[string | RegExp, string]>): void {
	let content = read(rel);
	for (const [search, replacement] of pairs) {
		if (typeof search === 'string') {
			content = content.split(search).join(replacement);
		} else {
			content = content.replace(search, replacement);
		}
	}
	write(rel, content);
}

function prompt(question: string, fallback: string): Promise<string> {
	const iface = ensureReadline();
	return new Promise((resolve) => {
		iface.question(`${question} [${fallback}]: `, (answer) => {
			resolve(answer.trim() || fallback);
		});
	});
}

async function resolveValue(
	flag: string | undefined,
	question: string,
	fallback: string
): Promise<string> {
	if (flag) return flag;
	if (!interactive) return fallback;
	return prompt(question, fallback);
}

function titleCase(slug: string): string {
	return slug
		.split('-')
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ');
}

// ---------------------------------------------------------------------------
// Detect current values (for re-run defaults)
// ---------------------------------------------------------------------------

function currentSlug(): string {
	const pkg = JSON.parse(read('package.json'));
	return pkg.name ?? 'saas-starter';
}

function currentRepo(): string {
	const readme = read('README.md');
	const match = readme.match(/github\.com\/([^/]+\/[^/\s)]+)/);
	return match?.[1]?.replace(/\.git$/, '') ?? 'user/my-saas';
}

function readLegalField(field: 'brandName' | 'companyName' | 'operatorName' | 'address'): string {
	const src = read('src/lib/config/legal.ts');
	const m = src.match(new RegExp(`${field}:\\s*'([^']*)'`));
	return m?.[1] ?? '';
}

function readLegalEmailParts(): { user: string; domain: string; tld: string } {
	const src = read('src/lib/config/legal.ts');
	const user = src.match(/user:\s*'([^']*)'/)?.[1] ?? '';
	const domain = src.match(/domain:\s*'([^']*)'/)?.[1] ?? '';
	const tld = src.match(/tld:\s*'([^']*)'/)?.[1] ?? '';
	return { user, domain, tld };
}

function currentBrand(): string {
	return readLegalField('brandName') || 'SaaS Starter';
}

function currentCompany(): string {
	return readLegalField('companyName') || `${currentBrand()} Inc.`;
}

function currentOperator(): string {
	return readLegalField('operatorName');
}

function currentAddress(): string {
	return readLegalField('address');
}

function currentEmail(): string {
	const { user, domain, tld } = readLegalEmailParts();
	if (!user || !domain || !tld) return '';
	return `${user}@${domain}.${tld}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	console.log('\n📦 Template Setup\n');

	if (!interactive) {
		const missing: string[] = [];
		if (!slugFlag) missing.push('--slug');
		if (!repoFlag) missing.push('--repo');
		if (!brandFlag) missing.push('--brand');
		if (missing.length > 0) {
			console.error(
				`Error: bun run setup needs --slug, --repo, --brand in non-interactive mode.\nMissing: ${missing.join(', ')}\nExample: bun run setup --slug my-app --repo owner/my-app --brand "My App"`
			);
			process.exit(1);
		}
	}

	const slug = await resolveValue(slugFlag, 'Project slug (lowercase, no spaces)', currentSlug());
	if (!/^[a-z0-9-]+$/.test(slug)) {
		console.error('Error: slug must match ^[a-z0-9-]+$ (lowercase letters, numbers, hyphens)');
		process.exit(1);
	}

	const repo = await resolveValue(repoFlag, 'GitHub repo (owner/name)', currentRepo());
	if (!/^[^/]+\/[^/]+$/.test(repo)) {
		console.error('Error: repo must be in owner/name format');
		process.exit(1);
	}
	const repoBasename = repo.split('/')[1];

	const oldBrand = currentBrand();
	const brand = await resolveValue(
		brandFlag,
		'Brand name (display name)',
		oldBrand === 'SaaS Starter' ? titleCase(slug) : oldBrand
	);

	const oldCompany = currentCompany();
	const company = await resolveValue(
		companyFlag,
		'Company name (legal entity)',
		oldCompany || `${brand} Inc.`
	);

	const oldOperator = currentOperator();
	const operator = await resolveValue(
		operatorFlag,
		'Operator name (person or org running the service)',
		oldOperator
	);

	const oldAddress = currentAddress();
	const address = await resolveValue(
		addressFlag,
		'Address (for Impressum and email footer)',
		oldAddress
	);

	const oldEmail = currentEmail();
	const email = await resolveValue(emailFlag, 'Contact email (user@domain.tld)', oldEmail);
	const emailMatch = email.match(/^([^@]+)@([^.]+)\.(.+)$/);
	if (!emailMatch) {
		console.error(`Error: email must match user@domain.tld pattern, got: ${email}`);
		process.exit(1);
	}
	const [, emailUser, emailDomain, emailTld] = emailMatch;

	const oldSlug = currentSlug();
	const oldRepo = currentRepo();
	const githubUrl = `https://github.com/${repo}`;
	const oldGithubUrl = `https://github.com/${oldRepo}`;

	console.log(`\nApplying: slug=${slug}, repo=${repo}, brand="${brand}"\n`);

	// package.json — name and author
	const pkg = JSON.parse(read('package.json'));
	pkg.name = slug;
	pkg.author = operator;
	write('package.json', JSON.stringify(pkg, null, '\t') + '\n');
	console.log('  ✓ package.json');

	// wrangler.toml
	replace('wrangler.toml', [[`name = "${oldSlug}"`, `name = "${slug}"`]]);
	console.log('  ✓ wrangler.toml');

	// README.md
	replace('README.md', [
		[`# ${oldBrand}`, `# ${brand}`],
		[oldGithubUrl, githubUrl],
		[`cd ${oldSlug === 'saas-starter' ? 'saas-starter' : repoBasename}`, `cd ${repoBasename}`],
		// Remove demo link line (matches the > See a live demo... line)
		[/^> See a live demo.*\n\n/m, '']
	]);
	console.log('  ✓ README.md');

	// Marketing header — keep the GitHub URL rewrite; the brand text reads from LEGAL_CONFIG now
	replace('src/lib/components/marketing/marketing-header.svelte', [[oldGithubUrl, githubUrl]]);
	console.log('  ✓ marketing-header.svelte');

	// Authenticated header
	replace('src/lib/components/authenticated/authenticated-header.svelte', [
		[oldGithubUrl, githubUrl]
	]);
	console.log('  ✓ authenticated-header.svelte');

	// Legal config — single source of truth for brand identity
	const oldUser = readLegalEmailParts().user;
	const oldDomain = readLegalEmailParts().domain;
	const oldTld = readLegalEmailParts().tld;
	const oldEmailBlock = `user: '${oldUser}',\n\t\tdomain: '${oldDomain}',\n\t\ttld: '${oldTld}'`;
	const newEmailBlock = `user: '${emailUser}',\n\t\tdomain: '${emailDomain}',\n\t\ttld: '${emailTld}'`;
	replace('src/lib/config/legal.ts', [
		[`brandName: '${oldBrand}'`, `brandName: '${brand}'`],
		[`companyName: '${oldCompany}'`, `companyName: '${company}'`],
		[`operatorName: '${oldOperator}'`, `operatorName: '${operator}'`],
		[`address: '${oldAddress}'`, `address: '${address}'`],
		[oldEmailBlock, newEmailBlock]
	]);
	console.log('  ✓ legal.ts');

	console.log('\n✅ Done! Next steps:');
	console.log('  1. Replace static/logo.svg with your logo, then run: bun run build:emails');
	console.log('  2. Refresh email snapshots: bun run test:unit -- email-snapshots.test.ts -u');
	console.log(
		'  3. Update editorial brand mentions in src/i18n/*.json (FAQ, hero, marketing prose, pricing tier names)'
	);
	console.log(
		'  4. Update src/lib/content/privacy.ts and terms.ts if you want different legal copy'
	);
	console.log('');
	rl?.close();
}

main();
