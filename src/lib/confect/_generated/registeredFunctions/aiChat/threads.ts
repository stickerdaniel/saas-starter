import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../aiChat/threads.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../aiChat/threads.spec")["default"]>(databaseSchema, groupLayer);
