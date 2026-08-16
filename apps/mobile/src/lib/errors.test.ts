import { TRPCClientError } from "@trpc/client";
import { formatApiError } from "./errors";

/** What a link hands the caller once the server has refused. */
const apiError = (code: string, message: string) =>
  TRPCClientError.from({
    error: {
      code: -32603,
      message,
      data: { code, httpStatus: 412, path: "household.removeMember" },
    },
  });

/** A dropped connection — a `TRPCClientError` too, but with no shape on it. */
const transportError = () =>
  TRPCClientError.from(new Error("Network request failed"));

describe("formatApiError", () => {
  it("quotes the server", () => {
    const error = apiError("FORBIDDEN", "Only the household owner can do that");

    expect(formatApiError(error, "fallback")).toBe(
      "Only the household owner can do that",
    );
  });

  it("falls back when the request never reached the router", () => {
    expect(formatApiError(transportError(), "fallback")).toBe("fallback");
  });
});
