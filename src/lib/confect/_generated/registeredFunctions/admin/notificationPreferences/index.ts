import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../../schema";
import groupLayer from "../../../../admin/notificationPreferences/index.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../../admin/notificationPreferences/index.spec")["default"]>(databaseSchema, groupLayer);
