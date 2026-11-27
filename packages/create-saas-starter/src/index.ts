#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { templateProfiles, validateTemplateArchive } from './archive.js';
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
	resolveOptions,
	type PromptAdapter
} from './prompts.js';
import { installSteps, runSetupAndInstall, setupArguments, verifyBun } from './process.js';
import {
	createStagingTarget,
	initialMarker,
	inspectTarget,
	publishStagedTarget,
	StagingTargetError,
	throwIfAborted,
	updateMarker,
	validateArchiveTargetPaths,
	writeArchive,
	writeArchiveList,
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
	prompts?: PromptAdapter;
	interrupts?: InterruptEmitter;
}

export interface CliRuntime {
	inspectTarget: typeof inspectTarget;
	createStagingTarget: typeof createStagingTarget;
	publishStagedTarget: typeof publishStagedTarget;
	runSetupAndInstall: typeof runSetupAndInstall;
	updateMarker: typeof updateMarker;
}

const defaultIo: CliIo = {
	stdout: (message) => console.log(message),
	stderr: (message) => console.error(message),
	stdin: process.stdin,
	environment: process.env,
	cwd: process.cwd()
};

const defaultRuntime: CliRuntime = {
	inspectTarget,
	createStagingTarget,
	publishStagedTarget,
	runSetupAndInstall,
	updateMarker
};

export interface InterruptEmitter {
	on(event: 'SIGINT', listener: () => void): unknown;
	off(event: 'SIGINT', listener: () => void): unknown;
}

export function listenForInterrupt(
	listener: () => void,
	emitter: InterruptEmitter = process
): () => void {
	emitter.on('SIGINT', listener);
	return () => emitter.off('SIGINT', listener);
}

/** The generated SvelteKit 3 project needs Node.js 22.17 or newer. */
export function assertSupportedNodeVersion(version = process.versions.node): void {
	const [major, minor] = version.split('.').map(Number);
	if (major! < 22 || (major === 22 && minor! < 17)) {
		throw new Error('Node.js 22.17.0 or newer is required.');
	}
}

function legalReminder(options: Awaited<ReturnType<typeof resolveOptions>>): string | undefined {
	const { company, operator, street, postalCode, city, country, email } = options;
	if (company && operator && street && postalCode && city && country && email) return undefined;
	return 'Review the generated legal identity values before publishing or deploying the project.';
}

function quoted(value: string, platform: NodeJS.Platform = process.platform): string {
	if (platform === 'win32') return `'${value.replaceAll("'", "''")}'`;
	return `'${value.replaceAll("'", "'\\''")}'`;
}

function navigation(target: string, platform: NodeJS.Platform = process.platform): string {
	return platform === 'win32'
		? `Set-Location -LiteralPath ${quoted(target, platform)}`
		: `cd ${quoted(target, platform)}`;
}

/** A command line for the user's shell: a plain argument stays bare, any other is quoted. */
function commandLine(command: string, args: string[]): string {
	return [command, ...args.map((arg) => (/^[\w./-][\w./=-]*$/.test(arg) ? arg : quoted(arg)))].join(
		' '
	);
}

export async function runCli(
	args: string[],
	io: CliIo = defaultIo,
	runtimeOverrides: Partial<CliRuntime> = {}
): Promise<number> {
	const runtime = { ...defaultRuntime, ...runtimeOverrides };
	const controller = new AbortController();
	let interrupted = false;
	const onSigint = () => {
		interrupted = true;
		controller.abort(new Error('Scaffolding interrupted.'));
	};
	const removeInterruptListener = listenForInterrupt(onSigint, io.interrupts);
	let recoveryPath: string | undefined;
	let recovery: string[] = [];
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
		const options = await resolveOptions(parsed, {
			interactive,
			prompts: io.prompts,
			signal: controller.signal
		});
		const target = await runtime.inspectTarget(options.directory, io.cwd);
		throwIfAborted(controller.signal);

		if (options.dryRun) {
			io.stdout(`Dry run complete. Target is available: ${target.path}`);
			const reminder = legalReminder(options);
			if (reminder) io.stdout(reminder);
			return 0;
		}
		if (!interactive && !options.trustTemplate) {
			throw new UsageError('Template execution requires explicit --trust-template.');
		}

		const bun = await verifyBun(controller.signal, io.environment, io.cwd);
		const resolved = await resolveTemplateRef(options.ref, controller.signal);
		const compressed = await downloadTemplateArchive(resolved.sha, controller.signal);
		throwIfAborted(controller.signal);
		const archive = await validateTemplateArchive(compressed);
		throwIfAborted(controller.signal);
		const profiles = templateProfiles(archive, resolved.sha);
		if (options.withoutTests && !profiles.includes('tests')) {
			throw new Error(
				`Template revision ${resolved.sha} cannot leave out the test suite: its package.json has no "tests" in templateProfiles.`
			);
		}
		validateArchiveTargetPaths(target.path, archive);
		await confirmTemplateTrust(
			resolved.sha,
			interactive,
			options.trustTemplate,
			controller.signal,
			io.prompts
		);
		throwIfAborted(controller.signal);

		marker = initialMarker({
			ref: resolved.ref,
			sha: resolved.sha,
			archiveSha256: archive.sha256
		});
		let staging: string;
		try {
			staging = await runtime.createStagingTarget(target, marker, controller.signal, {
				environment: io.environment
			});
		} catch (error) {
			if (error instanceof StagingTargetError) recoveryPath = error.recoveryPath;
			throw error;
		}
		recoveryPath = staging;
		validateArchiveTargetPaths(staging, archive);
		await writeArchive(staging, archive, controller.signal);
		const archiveList = options.withoutTests ? await writeArchiveList(staging, archive) : undefined;
		phase = 'setup';
		marker = await runtime.updateMarker(staging, marker, 'incomplete', phase);
		recovery = [
			options.withoutTests
				? 'To repeat setup without the test suite, run these commands:'
				: 'To repeat setup, run these commands:',
			navigation(staging),
			commandLine('bun', setupArguments(options, archiveList))
		];

		const state = await runtime.runSetupAndInstall({
			bun: bun.executable,
			environment: bun.environment,
			target: staging,
			options,
			archiveList,
			signal: controller.signal,
			onSetupComplete: async () => {
				if (archiveList) {
					await rm(archiveList, { force: true }).catch(() => {});
					await rmdir(path.dirname(archiveList)).catch(() => {});
				}
				recovery = [
					options.withoutTests
						? 'Setup left out the test suite. To install the dependencies, run these commands:'
						: 'To install the dependencies, run these commands:',
					navigation(staging),
					...installSteps(options.withoutTests).map((args) => commandLine('bun', args))
				];
				phase = 'install';
				marker = await runtime.updateMarker(staging, marker!, 'incomplete', phase);
			}
		});
		throwIfAborted(controller.signal);
		if (state === 'ready') recovery = [];
		phase = 'complete';
		marker = await runtime.updateMarker(staging, marker, state, phase);
		throwIfAborted(controller.signal);
		const publication = await runtime.publishStagedTarget(target, staging, controller.signal);
		recoveryPath = undefined;
		if (publication.retainedStaging) {
			io.stderr(
				`Warning: The project was created successfully, but staging files remain at ${publication.retainedStaging}.`
			);
		}

		io.stdout(`Created ${options.brand} at ${target.path}`);
		io.stdout(navigation(target.path));
		if (state === 'needs-install') {
			const [first, ...checks] = installSteps(options.withoutTests);
			io.stdout(`Run bun ${first.join(' ')} before starting the app.`);
			for (const check of checks)
				io.stdout(`Then run bun ${check.join(' ')} to check the lockfile.`);
		}
		io.stdout('Run bun run dev and open the URL it prints.');
		io.stdout(
			'The generated README lists the seeded local test account. Use it only for local development.'
		);
		const reminder = legalReminder(options);
		if (reminder) io.stdout(reminder);
		return 0;
	} catch (error) {
		if (recoveryPath && marker) {
			await runtime.updateMarker(recoveryPath, marker, 'incomplete', phase).catch(() => {});
		}
		if (interrupted || controller.signal.aborted) {
			io.stderr(
				recoveryPath
					? `Scaffolding interrupted. Recovery files were preserved at ${recoveryPath}.`
					: 'Scaffolding interrupted before recovery files were created.'
			);
			for (const line of recovery) io.stderr(line);
			return 130;
		}
		if (error instanceof PromptCancelledError) return 130;
		const message = error instanceof Error ? error.message : String(error);
		io.stderr(
			error instanceof UsageError
				? `Error: ${message}\nRun create-saas-starter --help for usage.`
				: `Error: ${message}`
		);
		if (recoveryPath) {
			io.stderr(
				`Recovery files were preserved at ${recoveryPath}. Resolve the reported phase and continue manually.`
			);
		}
		for (const line of recovery) io.stderr(line);
		return 1;
	} finally {
		removeInterruptListener();
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
