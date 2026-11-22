import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import {
	CapabilityConfigurationError,
	githubOAuth,
	googleOAuth,
	requireAiConfiguration,
	requireBillingConfiguration,
	requireEmailConfiguration,
	requireEnv as readRequiredEnv
} from '../confect/env';

export class CapabilityUnavailable extends Data.TaggedError('CapabilityUnavailable')<{
	readonly capability: CapabilityConfigurationError['capability'];
	readonly state: CapabilityConfigurationError['state'];
}> {}

export const requireEnv = (...args: Parameters<typeof readRequiredEnv>) =>
	Effect.sync(() => readRequiredEnv(...args));

const capability = <Value>(read: () => Value) =>
	Effect.suspend(() => {
		try {
			return Effect.succeed(read());
		} catch (error) {
			return error instanceof CapabilityConfigurationError
				? Effect.fail(
						new CapabilityUnavailable({ capability: error.capability, state: error.state })
					)
				: Effect.die(error);
		}
	});

export const billingConfiguration = capability(() => requireBillingConfiguration());

export const emailConfiguration = capability(() => requireEmailConfiguration());

export const aiConfiguration = capability(() => requireAiConfiguration());

export const oauthProviders = Effect.sync(() => ({ google: googleOAuth, github: githubOAuth }));
