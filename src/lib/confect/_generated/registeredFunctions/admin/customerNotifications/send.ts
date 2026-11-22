import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../../schema";
import groupLayer from "../../../../admin/customerNotifications/send.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../../admin/customerNotifications/send.spec")["default"]>(databaseSchema, groupLayer);
