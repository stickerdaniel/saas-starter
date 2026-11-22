import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../files/metadata.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../files/metadata.spec")["default"]>(databaseSchema, groupLayer);
