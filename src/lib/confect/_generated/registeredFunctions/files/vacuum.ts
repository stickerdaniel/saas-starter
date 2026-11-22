import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../files/vacuum.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../files/vacuum.spec")["default"]>(databaseSchema, groupLayer);
