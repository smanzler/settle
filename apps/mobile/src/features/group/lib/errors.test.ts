import { TRPCClientError } from "@trpc/client";
import { formatJoinError } from "./errors";

/** What a link hands the caller once the server has refused. */
const apiError = (code: string, message: string) =>
  TRPCClientError.from({
    error: {
      code: -32603,
      message,
      data: { code, httpStatus: 412, path: "groups.removeMember" },
    },
  });

/** A dropped connection — a `TRPCClientError` too, but with no shape on it. */
const transportError = () =>
  TRPCClientError.from(new Error("Network request failed"));

describe("formatJoinError", () => {
  it("explains the codes the join screen owns", () => {
    const error = apiError(
      "NOT_FOUND",
      "That invite is not valid for this account",
    );

    expect(formatJoinError(error)).toContain("different email address");
  });

  // CONFLICT covers two refusals; only the server knows which one happened.
  it("passes a conflict through verbatim", () => {
    const message = "You are already a member of this group";

    expect(formatJoinError(apiError("CONFLICT", message))).toBe(message);
  });

  it("says nothing specific about a dropped connection", () => {
    expect(formatJoinError(transportError())).toBe(
      "Something went wrong. Please try again.",
    );
  });
});
