import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../schema";
import groupLayer from "../../auth.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../auth.spec")["default"]>(databaseSchema, groupLayer);
