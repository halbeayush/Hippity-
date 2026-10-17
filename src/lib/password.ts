import { randomBytes, scrypt, timingSafeEqual } from "crypto";

// Password hashing with Node's built-in scrypt — memory-hard, so a leaked
// hash is expensive to brute-force, and no extra dependency. Stored as
// "scrypt$<salt>$<hash>" (base64url), with a fresh random salt per password.
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, saltText, hashText] = stored.split("$");
  if (scheme !== "scrypt" || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, "base64url");
  const actual = await derive(password, Buffer.from(saltText, "base64url"));
  // Constant-time, so response timing doesn't reveal how much matched.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
