import { FunctionSpec, GroupSpec } from '@confect/core';
import type {
	dismissPasskeyNudge,
	getPasskeyNudgeDismissal,
	hasPassword,
	setPassword,
	viewer
} from './users';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.convexPublicMutation<typeof dismissPasskeyNudge>()('dismissPasskeyNudge')
	)
	.addFunction(
		FunctionSpec.convexPublicQuery<typeof getPasskeyNudgeDismissal>()('getPasskeyNudgeDismissal')
	)
	.addFunction(FunctionSpec.convexPublicQuery<typeof hasPassword>()('hasPassword'))
	.addFunction(FunctionSpec.convexPublicMutation<typeof setPassword>()('setPassword'))
	.addFunction(FunctionSpec.convexPublicQuery<typeof viewer>()('viewer'));
