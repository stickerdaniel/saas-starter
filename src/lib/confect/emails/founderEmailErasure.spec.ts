import { FunctionSpec, GroupSpec } from '@confect/core';
import type { continueFounderEmailErasure, eraseFounderEmailPage } from './founderEmailErasure';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.convexInternalMutation<typeof continueFounderEmailErasure>()(
			'continueFounderEmailErasure'
		)
	)
	.addFunction(
		FunctionSpec.convexInternalMutation<typeof eraseFounderEmailPage>()('eraseFounderEmailPage')
	);
