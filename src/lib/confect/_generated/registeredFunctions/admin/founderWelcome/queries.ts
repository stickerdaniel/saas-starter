import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../../schema";
import groupLayer from "../../../../admin/founderWelcome/queries.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../../admin/founderWelcome/queries.spec")["default"]>(databaseSchema, groupLayer);
