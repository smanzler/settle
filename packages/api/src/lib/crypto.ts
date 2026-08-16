import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../env";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard — 96-bit nonce
const KEY = Buffer.from(env.ENCRYPTION_KEY, "hex");

/**
 * Symmetric encryption for secrets we must be able to read back (Plaid access
 * tokens). GCM rather than CBC so a tampered payload fails the auth tag check
 * instead of silently decrypting to garbage.
 *
 * Output is `iv:authTag:ciphertext`, all hex, so it fits a single text column.
 */
export const encrypt = (plaintext: string): string => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, KEY, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return [
    iv.toString("hex"),
    cipher.getAuthTag().toString("hex"),
    ciphertext.toString("hex"),
  ].join(":");
};

/** Throws if the payload is malformed or has been tampered with. */
export const decrypt = (payload: string): string => {
  const [ivHex, authTagHex, ciphertextHex] = payload.split(":");

  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error("Malformed encrypted payload");
  }

  const decipher = createDecipheriv(ALGORITHM, KEY, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
};
