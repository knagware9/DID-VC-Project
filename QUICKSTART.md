# Quick Start Guide

## Installation

1. Install dependencies:
```bash
npm install
```

## Running the Example

Run the basic flow example:
```bash
npm run dev src/examples/basic-flow.ts
```

Or build and run:
```bash
npm run build
npm start
```

## Project Overview

This project implements three main components:

### 1. Issuer (`src/issuer/Issuer.ts`)
Creates and signs verifiable credentials.

**Key Features:**
- Generate issuer DID
- Issue verifiable credentials
- Issue credentials as JWT
- Revoke credentials

### 2. Holder (`src/holder/Holder.ts`)
Stores credentials and creates presentations.

**Key Features:**
- Store verifiable credentials
- Create verifiable presentations
- Selective disclosure (show only specific fields)
- Check credential expiration
- Manage credential storage

### 3. Verifier (`src/verifier/Verifier.ts`)
Verifies credentials and presentations.

**Key Features:**
- Verify verifiable presentations
- Verify individual credentials
- Check credential revocation status
- Validate DID documents

## Example Usage

```typescript
import { VCIssuer, VCHolder, VCVerifier } from './src/index.js';

// Create actors
const issuer = new VCIssuer();
const holder = new VCHolder();
const verifier = new VCVerifier();

// Issue credential
const credential = await issuer.issueCredential(
  { name: 'John Doe', degree: 'BS' },
  ['EducationalCredential']
);

// Store credential
const credentialId = await holder.storeCredential(credential);

// Create presentation
const presentation = await holder.createPresentation([credentialId]);

// Verify presentation
const result = await verifier.verifyPresentation(presentation);
console.log(result.valid); // true/false
```

## Next Steps

1. **Customize Credential Types**: Modify credential schemas in the Issuer module
2. **Add Persistence**: Implement database storage for credentials
3. **Enhance Security**: Add proper cryptographic signing (currently uses placeholders)
4. **Add Revocation Registry**: Implement a distributed revocation registry
5. **Add DID Resolution**: Integrate with real DID resolvers for production use

## Notes

- Current implementation uses placeholder signatures for demonstration
- For production use, implement proper cryptographic signing
- DID resolution is simplified - integrate with real DID resolvers for production
- Credential storage is in-memory - add persistence for production use

