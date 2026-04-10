/**
 * DID utility functions
 */
import { generateDIDIdentifier } from './crypto.js';

/**
 * Create a simple DID document
 */
export function createDIDDocument(did: string, publicKey: Uint8Array): any {
  const publicKeyMultibase = `z${Buffer.from(publicKey).toString('base64url')}`;
  
  return {
    '@context': ['https://www.w3.org/ns/did/v1'],
    id: did,
    verificationMethod: [
      {
        id: `${did}#keys-1`,
        type: 'EcdsaSecp256k1VerificationKey2019',
        controller: did,
        publicKeyMultibase: publicKeyMultibase,
      },
    ],
    authentication: [`${did}#keys-1`],
    assertionMethod: [`${did}#keys-1`],
  };
}

/**
 * Generate a new DID with key pair
 */
export function generateDID(): { did: string; publicKey: Uint8Array; privateKey: Uint8Array } {
  const did = generateDIDIdentifier();
  // In a real implementation, you'd generate keys here
  // For now, return placeholder structure
  return {
    did,
    publicKey: new Uint8Array(33),
    privateKey: new Uint8Array(32),
  };
}

