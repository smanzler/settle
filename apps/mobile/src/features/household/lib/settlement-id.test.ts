import { newSettlementId } from "./settlement-id";

// A hand-rolled generator, because React Native ships no Web Crypto — so the
// grammar `z.uuid()` enforces on the other end is tested here instead.
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const SAMPLES = 500;

describe("newSettlementId", () => {
  test("every id matches the uuid v4 grammar", () => {
    const ids = Array.from({ length: SAMPLES }, newSettlementId);

    expect(ids.filter((id) => UUID_V4.test(id))).toHaveLength(SAMPLES);
  });

  test("ids are unique across a batch", () => {
    const ids = Array.from({ length: SAMPLES }, newSettlementId);

    expect(new Set(ids).size).toBe(SAMPLES);
  });

  test("pins the version and variant nibbles", () => {
    const id = newSettlementId();

    expect(id[14]).toBe("4");
    expect(["8", "9", "a", "b"]).toContain(id[19]);
  });
});
