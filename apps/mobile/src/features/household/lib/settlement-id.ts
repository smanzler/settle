/**
 * The idempotency key `settlements.create` dedupes on.
 *
 * Deliberately not `crypto.randomUUID()`: React Native ships no Web Crypto and
 * Expo's runtime installs none either, so the global is simply absent and
 * reaching for it takes the screen down the moment the sheet mounts. Nothing
 * here has to be unguessable, only unique — the id names one payment so that a
 * replay of it is a no-op instead of a second repayment.
 */
export const newSettlementId = (): string =>
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const nibble = Math.floor(Math.random() * 16);

    // `y` carries the `10xx` variant bits the uuid grammar — and `z.uuid()` on
    // the other end — insists on.
    return (char === "x" ? nibble : (nibble & 0x3) | 0x8).toString(16);
  });
