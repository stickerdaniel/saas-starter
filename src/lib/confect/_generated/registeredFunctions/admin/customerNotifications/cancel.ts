import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../../schema";
import groupLayer from "../../../../admin/customerNotifications/cancel.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../../admin/customerNotifications/cancel.spec")["default"]>(databaseSchema, groupLayer);
