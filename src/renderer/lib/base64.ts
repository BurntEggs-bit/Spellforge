/**
 * Binary data from the main process: it sends bytes over IPC as base64
 * inside the JSON (mesh vertices, animation tracks, skinning).
 */

/** The bytes of a base64 string, in a buffer of their own (typed arrays can view it at offset 0). */
export function base64Bytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** Little-endian 32-bit floats. */
export function base64Floats(b64: string): Float32Array<ArrayBuffer> {
  return new Float32Array(base64Bytes(b64).buffer)
}

/** Little-endian 32-bit unsigned integers. */
export function base64Uint32(b64: string): Uint32Array<ArrayBuffer> {
  return new Uint32Array(base64Bytes(b64).buffer)
}

/** Little-endian 16-bit unsigned integers. */
export function base64Uint16(b64: string): Uint16Array<ArrayBuffer> {
  return new Uint16Array(base64Bytes(b64).buffer)
}
