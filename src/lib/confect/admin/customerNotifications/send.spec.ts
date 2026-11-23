import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import { Id } from '../../_generated/id';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'enqueueRecipient',
			args: () => ({
				to: Schema.String,
				subject: Schema.String,
				html: Schema.String,
				text: Schema.String,
				template: Schema.Literals(['new-customer', 'cancellation'])
			}),
			returns: () => Schema.String
		})
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'sendCancellation',
			args: () => ({ notificationId: Id('customerNotifications') }),
			returns: () => Schema.Null
		})
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'sendNewCustomer',
			args: () => ({ notificationId: Id('customerNotifications') }),
			returns: () => Schema.Null
		})
	);
