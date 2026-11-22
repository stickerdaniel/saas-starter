import { FunctionSpec, GroupSpec } from '@confect/core';
import type {
	enforceAndTrackMessageUsage,
	list,
	markMessageSettled,
	removeMessage,
	send
} from './messages';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.convexInternalAction<typeof enforceAndTrackMessageUsage>()(
			'enforceAndTrackMessageUsage'
		)
	)
	.addFunction(FunctionSpec.convexPublicQuery<typeof list>()('list'))
	.addFunction(
		FunctionSpec.convexInternalMutation<typeof markMessageSettled>()('markMessageSettled')
	)
	.addFunction(FunctionSpec.convexInternalMutation<typeof removeMessage>()('removeMessage'))
	.addFunction(FunctionSpec.convexPublicMutation<typeof send>()('send'));
