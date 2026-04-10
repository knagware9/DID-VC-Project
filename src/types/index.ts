/**
 * Shared types for DID VC project
 */

export interface CredentialSubject {
  id?: string;
  [key: string]: any;
}

export interface VerifiableCredential {
  '@context': string[];
  id?: string;
  type: string[];
  issuer: string | { id: string; [key: string]: any };
  issuanceDate: string;
  expirationDate?: string;
  credentialSubject: CredentialSubject;
  credentialStatus?: CredentialStatus;
  proof?: Proof;
  [key: string]: any;
}

export interface VerifiablePresentation {
  '@context': string[];
  type: string[];
  verifiableCredential: VerifiableCredential[];
  holder?: string;
  proof?: Proof;
  [key: string]: any;
}

export interface Proof {
  type: string;
  created: string;
  proofPurpose: string;
  verificationMethod: string;
  jws?: string;
  [key: string]: any;
}

export interface CredentialStatus {
  id: string;
  type: string;
  [key: string]: any;
}

export interface DIDDocument {
  '@context': string[];
  id: string;
  verificationMethod?: VerificationMethod[];
  authentication?: string[];
  assertionMethod?: string[];
  [key: string]: any;
}

export interface VerificationMethod {
  id: string;
  type: string;
  controller: string;
  publicKeyMultibase?: string;
  publicKeyJwk?: any;
  [key: string]: any;
}

export interface KeyPair {
  did: string;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

export interface IssuanceOptions {
  expirationDate?: Date;
  credentialStatus?: CredentialStatus;
  [key: string]: any;
}

export interface VerificationResult {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
}

