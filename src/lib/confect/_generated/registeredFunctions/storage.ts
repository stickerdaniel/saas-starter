import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../schema";
import groupLayer from "../../storage.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../storage.spec")["default"]>(databaseSchema, groupLayer);
