/**
 * Holder module - Stores and presents Verifiable Credentials
 */
import { VerifiableCredential, VerifiablePresentation, CredentialSubject } from '../types/index.js';
import { generateKeyPair } from '../utils/crypto.js';
import { format } from 'date-fns';

export class VCHolder {
  private did: string;
  private credentials: Map<string, VerifiableCredential>;
  private privateKey: Uint8Array;

  constructor(did?: string, privateKey?: Uint8Array) {
    if (did && privateKey) {
      this.did = did;
      this.privateKey = privateKey;
    } else {
      const { privateKey: pk, publicKey } = generateKeyPair();
      this.privateKey = pk;
      this.did = `did:example:${Buffer.from(publicKey.slice(0, 16)).toString('hex')}`;
    }
    this.credentials = new Map();
  }

  /**
   * Get the holder's DID
   */
  getDID(): string {
    return this.did;
  }

  /**
   * Store a Verifiable Credential
   */
  async storeCredential(credential: VerifiableCredential): Promise<string> {
    const credentialId = credential.id || `vc:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;
    this.credentials.set(credentialId, credential);
    return credentialId;
  }

  /**
   * Get a stored credential by ID
   */
  async getCredential(credentialId: string): Promise<VerifiableCredential | undefined> {
    return this.credentials.get(credentialId);
  }

  /**
   * List all stored credential IDs
   */
  async listCredentialIds(): Promise<string[]> {
    return Array.from(this.credentials.keys());
  }

  /**
   * Get all stored credentials
   */
  async getAllCredentials(): Promise<VerifiableCredential[]> {
    return Array.from(this.credentials.values());
  }

  /**
   * Create a Verifiable Presentation from stored credentials
   */
  async createPresentation(
    credentialIds: string[],
    options?: {
      selectiveDisclosure?: boolean;
      fieldsToDisclose?: string[];
    }
  ): Promise<VerifiablePresentation> {
    const credentials: VerifiableCredential[] = [];

    for (const id of credentialIds) {
      const credential = this.credentials.get(id);
      if (credential) {
        if (options?.selectiveDisclosure && options?.fieldsToDisclose) {
          // Selective disclosure - only include specified fields
          const disclosedCredential = this.selectivelyDisclose(credential, options.fieldsToDisclose);
          credentials.push(disclosedCredential);
        } else {
          credentials.push(credential);
        }
      }
    }

    if (credentials.length === 0) {
      throw new Error('No valid credentials found for the provided IDs');
    }

    const presentation: VerifiablePresentation = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiablePresentation'],
      verifiableCredential: credentials,
      holder: this.did,
      proof: {
        type: 'Ed25519Signature2020',
        created: format(new Date(), "yyyy-MM-dd'T'HH:mm:ss'Z'"),
        proofPurpose: 'authentication',
        verificationMethod: `${this.did}#keys-1`,
        // In a real implementation, this would be a proper signature
        jws: 'placeholder-signature',
      },
    };

    return presentation;
  }

  /**
   * Selectively disclose only specified fields from a credential
   */
  private selectivelyDisclose(
    credential: VerifiableCredential,
    fieldsToDisclose: string[]
  ): VerifiableCredential {
    const disclosedCredential: VerifiableCredential = {
      ...credential,
      credentialSubject: {},
    };

    // Always include the ID if present
    if (credential.credentialSubject.id) {
      disclosedCredential.credentialSubject.id = credential.credentialSubject.id;
    }

    // Include only the specified fields
    for (const field of fieldsToDisclose) {
      if (credential.credentialSubject[field] !== undefined) {
        disclosedCredential.credentialSubject[field] = credential.credentialSubject[field];
      }
    }

    return disclosedCredential;
  }

  /**
   * Remove a credential from storage
   */
  async removeCredential(credentialId: string): Promise<boolean> {
    return this.credentials.delete(credentialId);
  }

  /**
   * Check if a credential is expired
   */
  isCredentialExpired(credential: VerifiableCredential): boolean {
    if (!credential.expirationDate) {
      return false; // No expiration date means it doesn't expire
    }
    const expirationDate = new Date(credential.expirationDate);
    return expirationDate < new Date();
  }
}

