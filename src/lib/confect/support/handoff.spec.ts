import { FunctionSpec, GroupSpec } from '@confect/core';
import type { internalSetHandoff, settleUnansweredTurn } from './handoff';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.convexInternalMutation<typeof internalSetHandoff>()('internalSetHandoff')
	)
	.addFunction(
		FunctionSpec.convexInternalMutation<typeof settleUnansweredTurn>()('settleUnansweredTurn')
	);
