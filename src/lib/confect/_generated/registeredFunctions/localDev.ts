import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../schema";
import groupLayer from "../../localDev.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../localDev.spec")["default"]>(databaseSchema, groupLayer);
