import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../../schema";
import groupLayer from "../../../../admin/support/mutations.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../../admin/support/mutations.spec")["default"]>(databaseSchema, groupLayer);
