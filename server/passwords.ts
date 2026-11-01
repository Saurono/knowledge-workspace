import { scrypt, randomBytes, createHash, timingSafeEqual } from "node:crypto"
const derive = (password: string, salt: Buffer) => new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)))
export const opaqueSecret = () => randomBytes(32).toString("base64url")
export const secretDigest = (raw: string) => createHash("sha256").update(raw).digest("hex")
export async function hashPassword(password: string) {
  const salt = randomBytes(32), key = await derive(password, salt)
  return `scrypt-v1$${salt.toString("hex")}$${key.toString("hex")}`
}
export async function verifyPassword(password: string, encoded: string | null) {
  const parts = encoded?.split("$")
  const valid = parts?.length === 3 && parts[0] === "scrypt-v1" && /^[a-f0-9]{64}$/.test(parts[1]) && /^[a-f0-9]{128}$/.test(parts[2])
  const key = await derive(password.length <= 256 ? password : "", valid ? Buffer.from(parts[1], "hex") : Buffer.alloc(32))
  return !!valid && timingSafeEqual(key, Buffer.from(parts[2], "hex"))
}
