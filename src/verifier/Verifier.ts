/**
 * Verifier module - Verifies Verifiable Presentations and Credentials
 */
import {
  VerifiablePresentation,
  VerifiableCredential,
  VerificationResult,
} from '../types/index.js';
import { Resolver } from 'did-resolver';
import { getResolver } from 'key-did-resolver';
import { verifyCredential, verifyPresentation } from 'did-jwt-vc';

export class VCVerifier {
  private resolver: Resolver;
  private revocationList: Set<string>;

  constructor() {
    // Initialize DID resolver
    const keyResolver = getResolver();
    this.resolver = new Resolver({
      ...keyResolver,
    });
    this.revocationList = new Set();
  }

  /**
   * Verify a Verifiable Presentation
   */
  async verifyPresentation(presentation: VerifiablePresentation): Promise<VerificationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check basic structure
    if (!presentation['@context'] || !Array.isArray(presentation['@context'])) {
      errors.push('Invalid @context in presentation');
    }

    if (!presentation.type || !presentation.type.includes('VerifiablePresentation')) {
      errors.push('Invalid type in presentation');
    }

    if (!presentation.verifiableCredential || !Array.isArray(presentation.verifiableCredential)) {
      errors.push('No verifiable credentials found in presentation');
      return { valid: false, errors };
    }

    // Verify each credential in the presentation
    const credentialResults = await Promise.all(
      presentation.verifiableCredential.map((vc) => this.verifyCredential(vc))
    );

    const invalidCredentials = credentialResults.filter((result) => !result.valid);
    if (invalidCredentials.length > 0) {
      errors.push(
        `${invalidCredentials.length} invalid credential(s) found in presentation`
      );
      invalidCredentials.forEach((result) => {
        if (result.errors) {
          errors.push(...result.errors);
        }
      });
    }

    // Check proof if present
    if (presentation.proof) {
      const proofValid = await this.verifyProof(presentation.proof, presentation);
      if (!proofValid) {
        errors.push('Invalid proof in presentation');
      }
    } else {
      warnings.push('No proof found in presentation');
    }

    // Check holder
    if (presentation.holder) {
      // Verify holder DID is valid
      try {
        const didDoc = await this.resolver.resolve(presentation.holder);
        if (!didDoc || !didDoc.didDocument) {
          warnings.push(`Could not resolve holder DID: ${presentation.holder}`);
        }
      } catch (error) {
        warnings.push(`Error resolving holder DID: ${error}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Verify a Verifiable Credential
   */
  async verifyCredential(credential: VerifiableCredential): Promise<VerificationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check basic structure
    if (!credential['@context'] || !Array.isArray(credential['@context'])) {
      errors.push('Invalid @context in credential');
    }

    if (!credential.type || !credential.type.includes('VerifiableCredential')) {
      errors.push('Invalid type in credential');
    }

    if (!credential.issuer) {
      errors.push('No issuer found in credential');
    }

    if (!credential.issuanceDate) {
      errors.push('No issuance date found in credential');
    }

    if (!credential.credentialSubject) {
      errors.push('No credential subject found in credential');
    }

    // Check expiration
    if (credential.expirationDate) {
      const expirationDate = new Date(credential.expirationDate);
      if (expirationDate < new Date()) {
        errors.push('Credential has expired');
      }
    }

    // Check if credential is revoked
    if (credential.id && this.revocationList.has(credential.id)) {
      errors.push('Credential has been revoked');
    }

    // Verify issuer DID
    const issuerDid = typeof credential.issuer === 'string' 
      ? credential.issuer 
      : credential.issuer.id;

    if (issuerDid) {
      try {
        const didDoc = await this.resolver.resolve(issuerDid);
        if (!didDoc || !didDoc.didDocument) {
          warnings.push(`Could not resolve issuer DID: ${issuerDid}`);
        }
      } catch (error) {
        warnings.push(`Error resolving issuer DID: ${error}`);
      }
    }

    // Verify proof if present
    if (credential.proof) {
      const proofValid = await this.verifyProof(credential.proof, credential);
      if (!proofValid) {
        errors.push('Invalid proof in credential');
      }
    } else {
      warnings.push('No proof found in credential');
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Verify a proof signature
   */
  private async verifyProof(proof: any, document: any): Promise<boolean> {
    // In a real implementation, you would verify the cryptographic signature
    // This is a simplified placeholder
    if (!proof.verificationMethod || !proof.created) {
      return false;
    }

    // Check if verification method exists
    try {
      const didDoc = await this.resolver.resolve(proof.verificationMethod.split('#')[0]);
      if (!didDoc || !didDoc.didDocument) {
        return false;
      }
    } catch {
      return false;
    }

    // Placeholder - in real implementation, verify the actual signature
    return true;
  }

  /**
   * Add a credential ID to the revocation list
   */
  revokeCredential(credentialId: string): void {
    this.revocationList.add(credentialId);
  }

  /**
   * Remove a credential ID from the revocation list (unrevoke)
   */
  unrevokeCredential(credentialId: string): void {
    this.revocationList.delete(credentialId);
  }

  /**
   * Check if a credential is revoked
   */
  isRevoked(credentialId: string): boolean {
    return this.revocationList.has(credentialId);
  }

  /**
   * Get all revoked credential IDs
   */
  getRevokedCredentials(): string[] {
    return Array.from(this.revocationList);
  }
}

