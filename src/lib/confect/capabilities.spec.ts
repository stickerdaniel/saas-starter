import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';

const CapabilityStatus = Schema.Union([
	Schema.Struct({ usable: Schema.Literal(true) }),
	Schema.Struct({ usable: Schema.Literal(false), reason: Schema.Literal('unavailable') })
]);

export default GroupSpec.make().addFunction(
	FunctionSpec.publicQuery({
		name: 'getUsability',
		args: () => ({}),
		returns: () => Schema.Struct({ billing: CapabilityStatus, ai: CapabilityStatus })
	})
);
