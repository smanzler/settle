import { TRPCClientError } from "@trpc/client";
import { formatJoinError, outstandingBalanceRefusal } from "./errors";

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

describe("outstandingBalanceRefusal", () => {
  it("keeps the sentence naming the balance and drops the instruction", () => {
    const error = apiError(
      "PRECONDITION_FAILED",
      "Ana still owes the group 214.30 USD. Write the balance off to remove them anyway.",
    );

    expect(outstandingBalanceRefusal(error)).toBe(
      "Ana still owes the group 214.30 USD.",
    );
  });

  it("reads the leaver's own refusal the same way", () => {
    const error = apiError(
      "PRECONDITION_FAILED",
      "The group still owes you 40.00 USD. Write the balance off to leave anyway.",
    );

    expect(outstandingBalanceRefusal(error)).toBe(
      "The group still owes you 40.00 USD.",
    );
  });

  // The other PRECONDITION_FAILED refusals. Offering a write-off for one of
  // them would put the user through the same dialog forever.
  it("ignores a refusal no write-off can repair", () => {
    expect(
      outstandingBalanceRefusal(
        apiError("PRECONDITION_FAILED", "A group must keep at least one owner"),
      ),
    ).toBeNull();

    expect(
      outstandingBalanceRefusal(
        apiError(
          "PRECONDITION_FAILED",
          "This group already has balances, so its currency is fixed. Settle up and start a new group instead.",
        ),
      ),
    ).toBeNull();
  });

  it("ignores anything that isn't an API refusal", () => {
    expect(outstandingBalanceRefusal(transportError())).toBeNull();
    expect(outstandingBalanceRefusal(new Error("boom"))).toBeNull();
  });
});

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
