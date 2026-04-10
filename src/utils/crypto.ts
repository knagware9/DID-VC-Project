/**
 * Cryptographic utilities for DID operations
 */
import * as secp256k1 from '@noble/secp256k1';
import { randomBytes, createHash } from 'crypto';

/**
 * Generate a new key pair for DID operations
 */
export function generateKeyPair(): { privateKey: Uint8Array; publicKey: Uint8Array } {
  const privateKey = secp256k1.utils.randomPrivateKey();
  const publicKey = secp256k1.getPublicKey(privateKey, true); // compressed

  return { privateKey, publicKey };
}

/**
 * Hash arbitrary data with SHA-256
 */
function sha256(data: Uint8Array): Uint8Array {
  const hash = createHash('sha256');
  hash.update(data);
  return hash.digest();
}

/**
 * Sign data with a private key
 */
export async function sign(data: Uint8Array, privateKey: Uint8Array): Promise<Uint8Array> {
  const hash = sha256(data);
  const signature = await secp256k1.sign(hash, privateKey);
  return signature.toCompactRawBytes();
}

/**
 * Verify a signature
 */
export async function verify(
  data: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array
): Promise<boolean> {
  try {
    const hash = sha256(data);
    return secp256k1.verify(signature, hash, publicKey);
  } catch {
    return false;
  }
}

/**
 * Generate a random DID identifier
 */
export function generateDIDIdentifier(): string {
  const randomId = randomBytes(16).toString('hex');
  return `did:example:${randomId}`;
}

