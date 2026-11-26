import * as Console from 'effect/Console';
import * as Layer from 'effect/Layer';
import * as Logger from 'effect/Logger';
import type * as LogLevel from 'effect/LogLevel';
import * as References from 'effect/References';

const methods = {
	All: 'log',
	Trace: 'debug',
	Debug: 'debug',
	Info: 'log',
	Warn: 'warn',
	Error: 'error',
	Fatal: 'error',
	None: 'log'
} as const satisfies Record<LogLevel.LogLevel, 'log' | 'debug' | 'warn' | 'error'>;

export const consoleLogger = Logger.make(({ fiber, logLevel, message, cause }) => {
	const args: readonly unknown[] = Array.isArray(message) ? message : [message];
	const out = fiber.getRef(Console.Console);
	out[methods[logLevel]](...args, ...(cause.reasons.length > 0 ? [cause] : []));
});

export const consoleLogging = Layer.merge(
	Logger.layer([consoleLogger]),
	Layer.succeed(References.MinimumLogLevel, 'Debug')
);
