import {
  Expo,
  type ExpoPushMessage,
  type ExpoPushTicket,
} from "expo-server-sdk";
import { env } from "../env";

const options = env.EXPO_ACCESS_TOKEN
  ? { accessToken: env.EXPO_ACCESS_TOKEN }
  : {};

export const expo = new Expo(options);

export const buildPushMessage = ({
  token,
  title,
  body,
  data,
}: {
  token: string;
  title: string;
  body?: string | null;
  data?: Record<string, unknown> | null;
}): ExpoPushMessage | null => {
  if (!Expo.isExpoPushToken(token)) return null;

  return {
    to: token,
    title,
    sound: "default",
    ...(body ? { body } : {}),
    ...(data ? { data } : {}),
  };
};

export type PushTicketOutcome =
  | { status: "sent" }
  | { status: "failed"; lastError: string; invalidToken?: boolean };

export const getTicketOutcome = (ticket: ExpoPushTicket): PushTicketOutcome => {
  switch (ticket.status) {
    case "ok":
      return { status: "sent" };
    case "error":
      return {
        status: "failed",
        lastError: ticket.message,
        invalidToken: ticket.details?.error === "DeviceNotRegistered",
      };
  }
};
