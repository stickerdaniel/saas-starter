import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../files/cleanup.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../files/cleanup.spec")["default"]>(databaseSchema, groupLayer);
