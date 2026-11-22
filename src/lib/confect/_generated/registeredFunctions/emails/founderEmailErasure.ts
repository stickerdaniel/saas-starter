import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../emails/founderEmailErasure.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../emails/founderEmailErasure.spec")["default"]>(databaseSchema, groupLayer);
