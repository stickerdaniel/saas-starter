#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateTemplateArchive } from './archive.js';
import {
	CLI_VERSION,
	HELP_TEXT,
	parseCliOptions,
	UsageError,
	validateProvidedValues
} from './options.js';
import {
	confirmTemplateTrust,
	isNonInteractive,
	PromptCancelledError,
	resolveOptions
} from './prompts.js';
import { runSetupAndInstall, verifyBun } from './process.js';
import {
	claimTarget,
	initialMarker,
	inspectTarget,
	TargetClaimError,
	updateMarker,
	writeArchive,
	type ScaffoldMarker,
	type ScaffoldPhase
} from './target.js';
import { downloadTemplateArchive, resolveTemplateRef } from './template.js';

export interface CliIo {
	stdout: (message: string) => void;
	stderr: (message: string) => void;
	stdin: NodeJS.ReadStream;
	environment: NodeJS.ProcessEnv;
	cwd: string;
}

const defaultIo: CliIo = {
	stdout: (message) => console.log(message),
	stderr: (message) => console.error(message),
	stdin: process.stdin,
	environment: process.env,
	cwd: process.cwd()
};

function assertSupportedNodeVersion(): void {
	const [major, minor] = process.versions.node.split('.').map(Number);
	if (major! < 22 || (major === 22 && minor! < 16)) {
		throw new Error('Node.js 22.16.0 or newer is required.');
	}
}

function legalReminder(options: Awaited<ReturnType<typeof resolveOptions>>): string | undefined {
	if (options.company && options.operator && options.address && options.email) return undefined;
	return 'Review the generated legal identity values before publishing or deploying the project.';
}

function navigation(target: string, platform: NodeJS.Platform = process.platform): string {
	if (platform === 'win32') return `Set-Location -LiteralPath '${target.replaceAll("'", "''")}'`;
	return `cd '${target.replaceAll("'", "'\\''")}'`;
}

export async function runCli(args: string[], io: CliIo = defaultIo): Promise<number> {
	const controller = new AbortController();
	let interrupted = false;
	const onSigint = () => {
		interrupted = true;
		controller.abort(new Error('Scaffolding interrupted.'));
	};
	process.once('SIGINT', onSigint);
	let claimedTarget: string | undefined;
	let marker: ScaffoldMarker | undefined;
	let phase: ScaffoldPhase = 'files';
	try {
		const parsed = parseCliOptions(args);
		if (parsed.help) {
			io.stdout(HELP_TEXT);
			return 0;
		}
		if (parsed.version) {
			io.stdout(CLI_VERSION);
			return 0;
		}
		assertSupportedNodeVersion();
		validateProvidedValues(parsed);
		const interactive = !parsed.dryRun && !isNonInteractive(parsed, io.stdin, io.environment);
		const options = await resolveOptions(parsed, { interactive });
		const target = await inspectTarget(options.directory, io.cwd);

		if (options.dryRun) {
			io.stdout(`Dry run complete. Target is available: ${target.path}`);
			const reminder = legalReminder(options);
			if (reminder) io.stdout(reminder);
			return 0;
		}
		if (!interactive && !options.trustTemplate) {
			throw new UsageError('Template execution requires explicit --trust-template.');
		}

		const bun = await verifyBun(controller.signal, io.environment);
		const resolved = await resolveTemplateRef(options.ref, controller.signal);
		const compressed = await downloadTemplateArchive(resolved.sha, controller.signal);
		const archive = await validateTemplateArchive(compressed);
		await confirmTemplateTrust(resolved.sha, interactive, options.trustTemplate);

		marker = initialMarker({
			ref: resolved.ref,
			sha: resolved.sha,
			archiveSha256: archive.sha256
		});
		try {
			await claimTarget(target, marker);
		} catch (error) {
			if (error instanceof TargetClaimError) claimedTarget = error.target;
			throw error;
		}
		claimedTarget = target.path;
		await writeArchive(target.path, archive);
		phase = 'setup';
		marker = await updateMarker(target.path, marker, 'incomplete', phase);

		const state = await runSetupAndInstall({
			bun: bun.executable,
			environment: bun.environment,
			target: target.path,
			options,
			signal: controller.signal,
			onSetupComplete: async () => {
				phase = 'install';
				marker = await updateMarker(target.path, marker!, 'incomplete', phase);
			}
		});
		phase = 'complete';
		marker = await updateMarker(target.path, marker, state, phase);

		io.stdout(`Created ${options.brand} at ${target.path}`);
		io.stdout(navigation(target.path));
		if (state === 'needs-install')
			io.stdout('Run bun install --frozen-lockfile before starting the app.');
		io.stdout('Run bun run dev and open the URL it prints.');
		io.stdout(
			'The generated README lists the seeded local test account. Use it only for local development.'
		);
		const reminder = legalReminder(options);
		if (reminder) io.stdout(reminder);
		return 0;
	} catch (error) {
		if (claimedTarget && marker) {
			await updateMarker(claimedTarget, marker, 'incomplete', phase).catch(() => {});
		}
		if (interrupted || controller.signal.aborted) {
			io.stderr('Scaffolding interrupted. The created target was preserved for inspection.');
			return 130;
		}
		if (error instanceof PromptCancelledError) return 130;
		const message = error instanceof Error ? error.message : String(error);
		io.stderr(
			error instanceof UsageError
				? `Error: ${message}\nRun create-saas-starter --help for usage.`
				: `Error: ${message}`
		);
		if (claimedTarget) {
			io.stderr(
				`The target was preserved at ${claimedTarget}. Resolve the reported phase and continue manually.`
			);
		}
		return 1;
	} finally {
		process.off('SIGINT', onSigint);
	}
}

function isMainModule(): boolean {
	if (!process.argv[1]) return false;
	try {
		return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
	} catch {
		return false;
	}
}

if (isMainModule()) process.exitCode = await runCli(process.argv.slice(2));
