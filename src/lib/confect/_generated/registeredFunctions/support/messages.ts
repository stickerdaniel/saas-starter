import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../support/messages.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../support/messages.spec")["default"]>(databaseSchema, groupLayer);

export default {
["createAIResponse"]: RegisteredConvexFunction.register({ ...definitions["createAIResponse"], handler: forward(definitions["createAIResponse"].handler) }),
["createAssistantMessage"]: RegisteredConvexFunction.register({ ...definitions["createAssistantMessage"], handler: forward(definitions["createAssistantMessage"].handler) }),
["ensureSupportTurnSettled"]: RegisteredConvexFunction.register({ ...definitions["ensureSupportTurnSettled"], handler: forward(definitions["ensureSupportTurnSettled"].handler) }),
["getFileMetadataBatch"]: RegisteredConvexFunction.register({ ...definitions["getFileMetadataBatch"], handler: forward(definitions["getFileMetadataBatch"].handler) }),
["getTurnOutcome"]: RegisteredConvexFunction.register({ ...definitions["getTurnOutcome"], handler: forward(definitions["getTurnOutcome"].handler) }),
["listMessages"]: RegisteredConvexFunction.register({ ...definitions["listMessages"], handler: forward(definitions["listMessages"].handler) }),
["sendMessage"]: RegisteredConvexFunction.register({ ...definitions["sendMessage"], handler: forward(definitions["sendMessage"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../support/messages.spec")["default"]>;
