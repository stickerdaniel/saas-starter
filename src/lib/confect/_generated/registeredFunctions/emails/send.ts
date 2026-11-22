import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../emails/send.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../emails/send.spec")["default"]>(databaseSchema, groupLayer);
