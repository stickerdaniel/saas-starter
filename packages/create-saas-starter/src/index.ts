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
	resolveOptions,
	type PromptAdapter
} from './prompts.js';
import { runSetupAndInstall, verifyBun } from './process.js';
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
		phase = 'setup';
		marker = await runtime.updateMarker(staging, marker, 'incomplete', phase);

		const state = await runtime.runSetupAndInstall({
			bun: bun.executable,
			environment: bun.environment,
			target: staging,
			options,
			signal: controller.signal,
			onSetupComplete: async () => {
				phase = 'install';
				marker = await runtime.updateMarker(staging, marker!, 'incomplete', phase);
			}
		});
		throwIfAborted(controller.signal);
		phase = 'complete';
		marker = await runtime.updateMarker(staging, marker, state, phase);
		throwIfAborted(controller.signal);
		await runtime.publishStagedTarget(target, staging, controller.signal);
		recoveryPath = undefined;

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
		if (recoveryPath && marker) {
			await runtime.updateMarker(recoveryPath, marker, 'incomplete', phase).catch(() => {});
		}
		if (interrupted || controller.signal.aborted) {
			io.stderr(
				recoveryPath
					? `Scaffolding interrupted. Recovery files were preserved at ${recoveryPath}.`
					: 'Scaffolding interrupted before recovery files were created.'
			);
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
