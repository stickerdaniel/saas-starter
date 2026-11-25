import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../emails/founderIncidentDrafts.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../emails/founderIncidentDrafts.spec")["default"]>(databaseSchema, groupLayer);

export default {
["previewDraft"]: RegisteredConvexFunction.register({ ...definitions["previewDraft"], handler: forward(definitions["previewDraft"].handler) }),
["queueDraft"]: RegisteredConvexFunction.register({ ...definitions["queueDraft"], handler: forward(definitions["queueDraft"].handler) }),
["saveDraft"]: RegisteredConvexFunction.register({ ...definitions["saveDraft"], handler: forward(definitions["saveDraft"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../emails/founderIncidentDrafts.spec")["default"]>;
