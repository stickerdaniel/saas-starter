import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../admin/queries.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../admin/queries.spec")["default"]>(databaseSchema, groupLayer);
