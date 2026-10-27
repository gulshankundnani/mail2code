// Passphrase-based encryption for backups, using only the platform's Web
// Crypto API (no custom cryptography, no extra library):
//   key  = PBKDF2-SHA256(passphrase, random 16-byte salt, 600,000 iterations) -> AES-256 key
//   data = AES-256-GCM(key, random 12-byte IV, plaintext), with the KDF and
//          cipher parameters as additional authenticated data
// The passphrase and key are never stored. A wrong passphrase or any change to
// the file makes decryption fail.
import { canonicalJson } from "@mail2code/protocol";
import { ENCRYPTED_FORMAT, EncryptedFileSchema, type EncryptedFile } from "./format.ts";

export const PBKDF2_ITERATIONS = 600_000;
export const MIN_PASSPHRASE_LENGTH = 12;

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number, usage: "encrypt" | "decrypt") {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, { name: "AES-GCM", length: 256 }, false, [usage]);
}

function header(f: Pick<EncryptedFile, "format" | "version" | "kdf" | "cipher">): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(canonicalJson({ format: f.format, version: f.version, kdf: f.kdf, cipher: f.cipher }));
}

export class PassphraseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PassphraseError";
  }
}

export function checkPassphrase(passphrase: string): void {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) throw new PassphraseError(`Use a passphrase of at least ${MIN_PASSPHRASE_LENGTH} characters.`);
}

export async function encryptText(plaintext: string, passphrase: string, iterations = PBKDF2_ITERATIONS): Promise<EncryptedFile> {
  checkPassphrase(passphrase);
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const meta = {
    format: ENCRYPTED_FORMAT as typeof ENCRYPTED_FORMAT,
    version: 1 as const,
    kdf: { name: "PBKDF2" as const, hash: "SHA-256" as const, iterations, salt: toB64(salt) },
    cipher: { name: "AES-GCM" as const, iv: toB64(iv) },
  };
  const key = await deriveKey(passphrase, salt, iterations, "encrypt");
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: header(meta) }, key, new TextEncoder().encode(plaintext));
  return EncryptedFileSchema.parse({ ...meta, ciphertext: toB64(new Uint8Array(ct)) });
}

export async function decryptText(file: EncryptedFile, passphrase: string): Promise<string> {
  const key = await deriveKey(passphrase, fromB64(file.kdf.salt), file.kdf.iterations, "decrypt");
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(file.cipher.iv), additionalData: header(file) }, key, fromB64(file.ciphertext));
    return new TextDecoder("utf-8", { fatal: true }).decode(pt);
  } catch {
    throw new PassphraseError("Wrong passphrase, or the file has been changed or damaged.");
  }
}
