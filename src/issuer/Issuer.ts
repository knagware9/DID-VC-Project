/**
 * Issuer module - Creates and signs Verifiable Credentials
 */
import { VerifiableCredential, CredentialSubject, IssuanceOptions } from '../types/index.js';
import { generateKeyPair } from '../utils/crypto.js';
import { createDIDDocument } from '../utils/did.js';
import { createVerifiableCredentialJwt, Issuer } from 'did-jwt-vc';
import { Resolver } from 'did-resolver';
import { getResolver } from 'key-did-resolver';
import { Ed25519Provider } from 'key-did-provider-ed25519';
import { format } from 'date-fns';

export class VCIssuer {
  private issuer: Issuer;
  private did: string;
  private resolver: Resolver;

  constructor(did?: string, privateKey?: Uint8Array) {
    // Initialize DID resolver
    const keyResolver = getResolver();
    this.resolver = new Resolver({
      ...keyResolver,
    });

    // Generate or use provided DID and keys
    if (did && privateKey) {
      this.did = did;
      // In a real implementation, you'd set up the issuer with the provided keys
      // For now, we'll use a placeholder approach
      this.issuer = {
        did: this.did,
        signer: async (data: string) => {
          // Placeholder - in real implementation, use actual signing
          return data;
        },
      } as any;
    } else {
      const { privateKey: pk, publicKey } = generateKeyPair();
      this.did = `did:example:${Buffer.from(publicKey.slice(0, 16)).toString('hex')}`;
      this.issuer = {
        did: this.did,
        signer: async (data: string) => {
          // Placeholder - in real implementation, use actual signing
          return data;
        },
      } as any;
    }
  }

  /**
   * Get the issuer's DID
   */
  getDID(): string {
    return this.did;
  }

  /**
   * Create and sign a Verifiable Credential
   */
  async issueCredential(
    credentialSubject: CredentialSubject,
    credentialType: string[],
    options?: IssuanceOptions
  ): Promise<VerifiableCredential> {
    const now = new Date();
    const expirationDate = options?.expirationDate || new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // Default 1 year

    const credential: Partial<VerifiableCredential> = {
      '@context': [
        'https://www.w3.org/2018/credentials/v1',
        'https://www.w3.org/2018/credentials/examples/v1',
      ],
      type: ['VerifiableCredential', ...credentialType],
      issuer: this.did,
      issuanceDate: format(now, "yyyy-MM-dd'T'HH:mm:ss'Z'"),
      expirationDate: format(expirationDate, "yyyy-MM-dd'T'HH:mm:ss'Z'"),
      credentialSubject,
    };

    if (options?.credentialStatus) {
      credential.credentialStatus = options.credentialStatus;
    }

    // In a real implementation, you would use did-jwt-vc to create a JWT VC
    // For now, we'll create a basic structure
    const vc: VerifiableCredential = {
      ...credential,
      credentialSubject,
    } as VerifiableCredential;

    return vc;
  }

  /**
   * Create a Verifiable Credential as JWT
   */
  async issueCredentialJWT(
    credentialSubject: CredentialSubject,
    credentialType: string[],
    options?: IssuanceOptions
  ): Promise<string> {
    const vc = await this.issueCredential(credentialSubject, credentialType, options);
    
    // In a real implementation, you would use createVerifiableCredentialJwt
    // This is a simplified version
    const payload = {
      vc,
      sub: credentialSubject.id || this.did,
      iss: this.did,
      nbf: Math.floor(Date.now() / 1000),
      exp: options?.expirationDate 
        ? Math.floor(options.expirationDate.getTime() / 1000)
        : Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
    };

    // Return a placeholder JWT - in real implementation, sign this properly
    return `eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
  }

  /**
   * Revoke a credential (add to revocation list)
   */
  async revokeCredential(credentialId: string, revocationListId: string): Promise<void> {
    // In a real implementation, you would update a revocation registry
    console.log(`Credential ${credentialId} revoked in list ${revocationListId}`);
  }
}

