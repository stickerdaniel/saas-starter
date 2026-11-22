import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../../../schema";
import groupLayer from "../../../../../admin/journey/sources/community.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../../../admin/journey/sources/community.spec")["default"]>(databaseSchema, groupLayer);
