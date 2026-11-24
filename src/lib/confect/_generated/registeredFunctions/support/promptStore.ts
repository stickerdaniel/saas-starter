import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../support/promptStore.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../support/promptStore.spec")["default"]>(databaseSchema, groupLayer);

export default {
["getActive"]: RegisteredConvexFunction.register({ ...definitions["getActive"], handler: forward(definitions["getActive"].handler) }),
["savePrompt"]: RegisteredConvexFunction.register({ ...definitions["savePrompt"], handler: forward(definitions["savePrompt"].handler) }),
["setActive"]: RegisteredConvexFunction.register({ ...definitions["setActive"], handler: forward(definitions["setActive"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../support/promptStore.spec")["default"]>;
