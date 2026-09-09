import { DeploymentError } from './execution';

/** The entrypoint reports a failure once, without raw provider errors or captures. */
export function reportCliFailure(error: unknown): void {
	console.error(
		error instanceof DeploymentError
			? `[${error.code}] ${error.message}`
			: 'Deployment failed unexpectedly.'
	);
}

/** Keep handlers installed until the runner has settled its children, then release them. */
export async function withCliSignals<T>(main: (signal: AbortSignal) => Promise<T>): Promise<T> {
	const controller = new AbortController();
	const abort = () => controller.abort();
	process.on('SIGINT', abort);
	process.on('SIGTERM', abort);
	try {
		return await main(controller.signal);
	} finally {
		process.off('SIGINT', abort);
		process.off('SIGTERM', abort);
	}
}
