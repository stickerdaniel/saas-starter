import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../admin/mutations.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../admin/mutations.spec")["default"]>(databaseSchema, groupLayer);
