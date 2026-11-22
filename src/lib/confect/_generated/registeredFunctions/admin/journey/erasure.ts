import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../../schema";
import groupLayer from "../../../../admin/journey/erasure.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../../admin/journey/erasure.spec")["default"]>(databaseSchema, groupLayer);
