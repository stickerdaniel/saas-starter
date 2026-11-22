import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../schema";
import groupLayer from "../../users.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../users.spec")["default"]>(databaseSchema, groupLayer);
