import { FunctionSpec, GroupSpec } from '@confect/core';
import type {
	getFounderEmailSettings,
	getFounderWelcomeConfig,
	getFounderWelcomeConfigInternal
} from './queries';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.convexPublicQuery<typeof getFounderEmailSettings>()('getFounderEmailSettings')
	)
	.addFunction(
		FunctionSpec.convexPublicQuery<typeof getFounderWelcomeConfig>()('getFounderWelcomeConfig')
	)
	.addFunction(
		FunctionSpec.convexInternalQuery<typeof getFounderWelcomeConfigInternal>()(
			'getFounderWelcomeConfigInternal'
		)
	);
