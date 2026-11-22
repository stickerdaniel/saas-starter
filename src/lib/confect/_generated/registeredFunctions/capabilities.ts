import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../schema";
import groupLayer from "../../capabilities.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../capabilities.spec")["default"]>(databaseSchema, groupLayer);
