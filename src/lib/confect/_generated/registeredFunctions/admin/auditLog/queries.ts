import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../../schema";
import groupLayer from "../../../../admin/auditLog/queries.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../../admin/auditLog/queries.spec")["default"]>(databaseSchema, groupLayer);
