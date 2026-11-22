import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../../schema";
import groupLayer from "../../../../admin/support/queries.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../../admin/support/queries.spec")["default"]>(databaseSchema, groupLayer);
