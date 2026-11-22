import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../../schema";
import groupLayer from "../../../../admin/founderWelcome/mutations.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../../admin/founderWelcome/mutations.spec")["default"]>(databaseSchema, groupLayer);
