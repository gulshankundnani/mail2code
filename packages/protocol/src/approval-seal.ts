// Sealed blocks: approval requests and responses carried as plain text inside
// an email. The JSON is compressed (deflate-raw, built into browsers) and
// base64-encoded between marker lines, so it survives email unchanged:
//
//   -----BEGIN MAIL2CODE APPROVAL REQUEST-----
//   eJyNkMtOwzAQRf8l6zp...
//   -----END MAIL2CODE APPROVAL REQUEST-----
//
// Kept free of zod so the Gmail content script can find blocks cheaply; the
// extension pages unseal and validate them.

export type SealedKind = "request" | "response" | "update";

const LABEL: Record<SealedKind, string> = { request: "APPROVAL REQUEST", response: "APPROVAL RESPONSE", update: "PROGRESS UPDATE" };
const KIND_OF: Record<string, SealedKind> = { "APPROVAL REQUEST": "request", "APPROVAL RESPONSE": "response", "PROGRESS UPDATE": "update" };
// Upper bounds: a block in an email, and the JSON it may inflate to.
export const MAX_SEALED_CHARS = 1_000_000;
export const MAX_UNSEALED_BYTES = 512 * 1024;

export interface FoundBlock {
  kind: SealedKind;
  // The whole block including marker lines, as found.
  text: string;
}

const BLOCK_RE = /-----BEGIN MAIL2CODE (APPROVAL REQUEST|APPROVAL RESPONSE|PROGRESS UPDATE)-----([\s\S]*?)-----END MAIL2CODE \1-----/g;

// All sealed blocks in a piece of text, in order. Quoted replies ("> ") and
// line breaks added by mail clients are tolerated.
export function findSealedBlocks(text: string): FoundBlock[] {
  const out: FoundBlock[] = [];
  for (const m of text.slice(0, MAX_SEALED_CHARS * 4).matchAll(BLOCK_RE)) {
    if (m[0].length > MAX_SEALED_CHARS) continue;
    out.push({ kind: KIND_OF[m[1]!]!, text: m[0] });
  }
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, limit: number): Promise<Uint8Array> {
  const reader = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    // Stop early on a "zip bomb": a small block that inflates to a huge size.
    if (total > limit) {
      await reader.cancel();
      throw new SealError("too_large", "The approval data is too large.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export class SealError extends Error {
  readonly code: "too_large" | "damaged";
  constructor(code: SealError["code"], message: string) {
    super(message);
    this.name = "SealError";
    this.code = code;
  }
}

export async function seal(kind: SealedKind, json: string): Promise<string> {
  const packed = await pipe(new TextEncoder().encode(json), new CompressionStream("deflate-raw"), MAX_SEALED_CHARS);
  const lines = toBase64(packed).match(/.{1,76}/g) ?? [];
  return [`-----BEGIN MAIL2CODE ${LABEL[kind]}-----`, ...lines, `-----END MAIL2CODE ${LABEL[kind]}-----`].join("\n");
}

// Returns the JSON text inside a block of the expected kind.
export async function unseal(kind: SealedKind, block: string): Promise<string> {
  if (block.length > MAX_SEALED_CHARS) throw new SealError("too_large", "The approval data is too large.");
  const begin = `-----BEGIN MAIL2CODE ${LABEL[kind]}-----`;
  const end = `-----END MAIL2CODE ${LABEL[kind]}-----`;
  const a = block.indexOf(begin);
  const b = block.indexOf(end, a + begin.length);
  if (a < 0 || b < 0) throw new SealError("damaged", `This isn't a Mail2Code ${LABEL[kind].toLowerCase()}.`);
  // Drop quote markers and any whitespace a mail client inserted.
  const body = block
    .slice(a + begin.length, b)
    .replace(/^[ \t]*(?:>[ \t]?)+/gm, "")
    .replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) throw new SealError("damaged", "The approval data in this email is damaged.");
  try {
    const bytes = await pipe(fromBase64(body), new DecompressionStream("deflate-raw"), MAX_UNSEALED_BYTES);
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (err) {
    if (err instanceof SealError) throw err;
    throw new SealError("damaged", "The approval data in this email is damaged.");
  }
}
