import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../../../schema";
import groupLayer from "../../../../../admin/journey/sources/support.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../../../admin/journey/sources/support.spec")["default"]>(databaseSchema, groupLayer);
