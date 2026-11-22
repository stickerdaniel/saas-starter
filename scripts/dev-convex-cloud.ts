import { runCloudConfectDev } from './confect-dev';

export function cloudDevProfileCommands(): Array<[string, string[]]> {
	return [
		['bunx', ['convex', 'env', 'set', 'CAPABILITY_PROFILE', 'preview']],
		['bun', ['scripts/validate-convex-env.ts', '--expected-profile', 'preview']]
	];
}

function preflightCloudDevProfile(): void {
	for (const [command, args] of cloudDevProfileCommands()) {
		const result = Bun.spawnSync([command, ...args], { stdio: ['inherit', 'inherit', 'inherit'] });
		if (result.exitCode !== 0) process.exit(result.exitCode || 1);
	}
}

async function main(): Promise<void> {
	preflightCloudDevProfile();
	process.exit(await runCloudConfectDev({ args: process.argv.slice(2), env: { ...process.env } }));
}

if (import.meta.main) {
	await main();
}
