import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../emails/events.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../emails/events.spec")["default"]>(databaseSchema, groupLayer);
