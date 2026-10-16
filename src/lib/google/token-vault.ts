import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const keyVersion = "v1";

function encryptionKey() {
  const encoded = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!encoded) throw new Error("Missing required environment variable: GOOGLE_TOKEN_ENCRYPTION_KEY");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  return key;
}

export function encryptGoogleToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return {
    ciphertext: `${keyVersion}.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`,
    keyVersion,
  };
}

export function decryptGoogleToken(payload: string, version: string | null) {
  const [storedVersion, ivValue, tagValue, ciphertextValue] = payload.split(".");
  if (storedVersion !== keyVersion || version !== keyVersion || !ivValue || !tagValue || !ciphertextValue) {
    throw new Error("Unsupported or malformed Google token ciphertext.");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, "base64url")), decipher.final()]).toString("utf8");
}

export function createOAuthState(userId: string) {
  const nonce = randomBytes(32).toString("hex");
  const message = `${nonce}.${userId}`;
  const signature = createHmac("sha256", encryptionKey()).update(message).digest("hex");
  return `${message}.${signature}`;
}

export function validateOAuthState(state: string, userId: string) {
  const [nonce, stateUserId, signature] = state.split(".");
  if (!nonce || stateUserId !== userId || !signature) return false;
  const expected = createHmac("sha256", encryptionKey()).update(`${nonce}.${stateUserId}`).digest();
  const actual = Buffer.from(signature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
