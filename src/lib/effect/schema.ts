import * as Schema from 'effect/Schema';

export const toAiInputSchema = <S extends Schema.ConstraintDecoder<unknown>>(schema: S) =>
	Schema.toStandardJSONSchemaV1(Schema.toStandardSchemaV1(schema));

const EMAIL_PATTERN = /^[\w+-]+(?:\.[\w+-]+)*@[\da-zA-Z]+(?:[.-][\da-zA-Z]+)*\.[a-zA-Z]{2,}$/u;

export const isEmailAddress = Schema.is(Schema.String.check(Schema.isPattern(EMAIL_PATTERN)));
