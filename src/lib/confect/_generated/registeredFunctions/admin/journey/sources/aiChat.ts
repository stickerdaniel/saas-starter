import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../../../schema";
import groupLayer from "../../../../../admin/journey/sources/aiChat.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../../../admin/journey/sources/aiChat.spec")["default"]>(databaseSchema, groupLayer);
