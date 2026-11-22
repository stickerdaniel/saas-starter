import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../../schema";
import groupLayer from "../../../../admin/support/notifications.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../../admin/support/notifications.spec")["default"]>(databaseSchema, groupLayer);
