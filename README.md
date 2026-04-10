# DID VC Project

A comprehensive Decentralized Identifier (DID) and Verifiable Credentials (VC) implementation supporting three core roles: **Issuer**, **Holder**, and **Verifier**.

## Overview

This project implements a complete DID/VC system following W3C standards, allowing you to:

- **Issue** verifiable credentials as an Issuer
- **Store and present** credentials as a Holder
- **Verify** credentials and presentations as a Verifier

## Features

- ✅ **Issuer Module**: Create and sign verifiable credentials
- ✅ **Holder Module**: Store credentials and create verifiable presentations
- ✅ **Verifier Module**: Verify credentials and presentations
- ✅ **Selective Disclosure**: Present only specific fields from credentials
- ✅ **Credential Revocation**: Support for revoking credentials
- ✅ **TypeScript**: Fully typed implementation
- ✅ **W3C Standards**: Follows W3C Verifiable Credentials Data Model

## Installation

```bash
npm install
```

## Build

```bash
npm run build
```

## Usage

### Basic Example

```typescript
import { VCIssuer, VCHolder, VCVerifier } from './src/index.js';

// 1. Create an Issuer
const issuer = new VCIssuer();
console.log(`Issuer DID: ${issuer.getDID()}`);

// 2. Create a Holder
const holder = new VCHolder();
console.log(`Holder DID: ${holder.getDID()}`);

// 3. Issue a credential
const credential = await issuer.issueCredential(
  {
    id: holder.getDID(),
    name: 'John Doe',
    email: 'john.doe@example.com',
    degree: 'Bachelor of Science',
  },
  ['EducationalCredential', 'DegreeCredential']
);

// 4. Holder stores the credential
const credentialId = await holder.storeCredential(credential);

// 5. Holder creates a presentation
const presentation = await holder.createPresentation([credentialId]);

// 6. Verifier verifies the presentation
const verifier = new VCVerifier();
const result = await verifier.verifyPresentation(presentation);
console.log(`Valid: ${result.valid}`);
```

### Run Example

```bash
npm run dev src/examples/basic-flow.ts
```

## Project Structure

```
did-vc-project/
├── src/
│   ├── issuer/
│   │   └── Issuer.ts          # Issuer module
│   ├── holder/
│   │   └── Holder.ts          # Holder module
│   ├── verifier/
│   │   └── Verifier.ts        # Verifier module
│   ├── types/
│   │   └── index.ts           # Shared TypeScript types
│   ├── utils/
│   │   ├── crypto.ts          # Cryptographic utilities
│   │   └── did.ts             # DID utilities
│   ├── examples/
│   │   └── basic-flow.ts      # Example usage
│   └── index.ts               # Main entry point
├── package.json
├── tsconfig.json
└── README.md
```

## Modules

### VCIssuer

The Issuer module creates and signs verifiable credentials.

**Methods:**
- `getDID()`: Get the issuer's DID
- `issueCredential()`: Create a verifiable credential
- `issueCredentialJWT()`: Create a credential as JWT
- `revokeCredential()`: Revoke a credential

### VCHolder

The Holder module stores credentials and creates presentations.

**Methods:**
- `getDID()`: Get the holder's DID
- `storeCredential()`: Store a credential
- `getCredential()`: Retrieve a stored credential
- `createPresentation()`: Create a verifiable presentation
- `listCredentialIds()`: List all stored credential IDs
- `isCredentialExpired()`: Check if a credential is expired

### VCVerifier

The Verifier module verifies credentials and presentations.

**Methods:**
- `verifyPresentation()`: Verify a verifiable presentation
- `verifyCredential()`: Verify a verifiable credential
- `revokeCredential()`: Add credential to revocation list
- `isRevoked()`: Check if a credential is revoked

## Selective Disclosure

The Holder can create presentations with selective disclosure, revealing only specific fields:

```typescript
const presentation = await holder.createPresentation([credentialId], {
  selectiveDisclosure: true,
  fieldsToDisclose: ['name', 'degree'], // Only disclose these fields
});
```

## Credential Revocation

Credentials can be revoked by adding them to a revocation list:

```typescript
// Verifier revokes a credential
verifier.revokeCredential(credentialId);

// Check if revoked
const isRevoked = verifier.isRevoked(credentialId);
```

## Dependencies

- `did-jwt-vc`: Verifiable Credentials JWT handling
- `did-resolver`: DID resolution
- `key-did-resolver`: Key DID resolver
- `@noble/secp256k1`: Cryptographic operations
- `date-fns`: Date formatting
- `zod`: Schema validation

## Standards Compliance

This implementation follows:
- [W3C Verifiable Credentials Data Model v1.1](https://www.w3.org/TR/vc-data-model/)
- [W3C Decentralized Identifiers (DIDs) v1.0](https://www.w3.org/TR/did-core/)

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

