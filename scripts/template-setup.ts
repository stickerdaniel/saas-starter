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
 * Non-interactive mode (piped stdin, CI, agents) requires all three flags.
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
		help: { type: 'boolean', short: 'h', default: false }
	},
	strict: false,
	allowPositionals: false
});

if (values.help) {
	console.log(`Template Setup

Usage:
  bun run setup                                          (interactive)
  bun run setup --slug <s> --repo <owner/name> --brand <s>

Flags:
  --slug    Project slug (lowercase, hyphens; matches ^[a-z0-9-]+$)
  --repo    GitHub repo in owner/name format
  --brand   Brand display name
  -h, --help  Show this help

In non-interactive mode (piped stdin, CI), all three flags are required.
In interactive mode, missing flags are prompted with current values as defaults.`);
	process.exit(0);
}

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
	if (flag !== undefined && flag !== '') return flag;
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

function currentBrand(): string {
	const seo = read('src/lib/components/SEOHead.svelte');
	const match = seo.match(/\| (.+)<\/title>/);
	return match?.[1]?.trim() ?? 'SaaS Starter';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	console.log('\n📦 Template Setup\n');

	if (!interactive) {
		const missing: string[] = [];
		if (values.slug === undefined || values.slug === '') missing.push('--slug');
		if (values.repo === undefined || values.repo === '') missing.push('--repo');
		if (values.brand === undefined || values.brand === '') missing.push('--brand');
		if (missing.length > 0) {
			console.error(
				`Error: bun run setup needs --slug, --repo, --brand in non-interactive mode.\nMissing: ${missing.join(', ')}\nExample: bun run setup --slug my-app --repo owner/my-app --brand "My App"`
			);
			process.exit(1);
		}
	}

	const slug = await resolveValue(
		values.slug as string | undefined,
		'Project slug (lowercase, no spaces)',
		currentSlug()
	);
	if (!/^[a-z0-9-]+$/.test(slug)) {
		console.error('Error: slug must match ^[a-z0-9-]+$ (lowercase letters, numbers, hyphens)');
		process.exit(1);
	}

	const repo = await resolveValue(
		values.repo as string | undefined,
		'GitHub repo (owner/name)',
		currentRepo()
	);
	if (!/^[^/]+\/[^/]+$/.test(repo)) {
		console.error('Error: repo must be in owner/name format');
		process.exit(1);
	}
	const repoBasename = repo.split('/')[1];

	const brand = await resolveValue(
		values.brand as string | undefined,
		'Brand name (display name)',
		currentBrand() === 'SaaS Starter' ? titleCase(slug) : currentBrand()
	);

	const oldSlug = currentSlug();
	const oldRepo = currentRepo();
	const oldBrand = currentBrand();
	const githubUrl = `https://github.com/${repo}`;
	const oldGithubUrl = `https://github.com/${oldRepo}`;

	console.log(`\nApplying: slug=${slug}, repo=${repo}, brand="${brand}"\n`);

	// package.json — name field only
	const pkg = JSON.parse(read('package.json'));
	pkg.name = slug;
	write('package.json', JSON.stringify(pkg, null, '\t') + '\n');
	console.log('  ✓ package.json');

	// wrangler.toml
	replace('wrangler.toml', [[`name = "${oldSlug}"`, `name = "${slug}"`]]);
	console.log('  ✓ wrangler.toml');

	// README.md
	replace('README.md', [
		[`# ${oldBrand === 'SaaS Starter' ? 'SaaS Starter' : oldBrand}`, `# ${brand}`],
		[oldGithubUrl, githubUrl],
		[`cd ${oldSlug === 'saas-starter' ? 'saas-starter' : repoBasename}`, `cd ${repoBasename}`],
		// Remove demo link line (matches the > See a live demo... line)
		[/^> See a live demo.*\n\n/m, '']
	]);
	console.log('  ✓ README.md');

	// SEOHead.svelte
	replace('src/lib/components/SEOHead.svelte', [[`| ${oldBrand}</title>`, `| ${brand}</title>`]]);
	console.log('  ✓ SEOHead.svelte');

	// Marketing header
	replace('src/lib/components/marketing/marketing-header.svelte', [
		[oldGithubUrl, githubUrl],
		// Brand text between Logo component and closing Button
		[/(<Logo class="size-5" \/>)\n\t+.+/m, `$1\n\t\t\t\t\t${brand}`]
	]);
	console.log('  ✓ marketing-header.svelte');

	// Authenticated header
	replace('src/lib/components/authenticated/authenticated-header.svelte', [
		[oldGithubUrl, githubUrl]
	]);
	console.log('  ✓ authenticated-header.svelte');

	// Legal config
	replace('src/lib/config/legal.ts', [
		[`brandName: '${oldBrand}'`, `brandName: '${brand}'`],
		[`companyName: '${oldBrand} Inc.'`, `companyName: '${brand}'`]
	]);
	console.log('  ✓ legal.ts');

	// Email header
	replace('src/lib/emails/components/layout/EmailHeader.svelte', [
		[`appName = '${oldBrand}'`, `appName = '${brand}'`],
		[`alt="${oldBrand} Logo"`, `alt="${brand} Logo"`]
	]);
	console.log('  ✓ EmailHeader.svelte');

	// Support agent instructions
	replace('src/lib/convex/support/agent.ts', [[oldBrand, brand]]);
	console.log('  ✓ support/agent.ts');

	console.log('\n✅ Done! Next steps:');
	console.log(
		'  1. Update brand in translation files (src/i18n/*.json) — search for "SaaS Starter"'
	);
	console.log('  2. Update legal/privacy content in src/lib/content/ and src/lib/config/legal.ts');
	console.log('  3. Replace static/logo.svg with your logo, then run: bun run build:emails');
	console.log('');
	rl?.close();
}

main();
