/**
 * Example: Basic flow demonstrating Issuer, Holder, and Verifier
 */
import { VCIssuer } from '../issuer/Issuer.js';
import { VCHolder } from '../holder/Holder.js';
import { VCVerifier } from '../verifier/Verifier.js';

async function basicFlow() {
  console.log('=== DID VC Basic Flow Example ===\n');

  // 1. Create an Issuer
  console.log('1. Creating Issuer...');
  const issuer = new VCIssuer();
  console.log(`   Issuer DID: ${issuer.getDID()}\n`);

  // 2. Create a Holder
  console.log('2. Creating Holder...');
  const holder = new VCHolder();
  console.log(`   Holder DID: ${holder.getDID()}\n`);

  // 3. Issuer creates a credential
  console.log('3. Issuer creating credential...');
  const credential = await issuer.issueCredential(
    {
      id: holder.getDID(),
      name: 'John Doe',
      email: 'john.doe@example.com',
      degree: 'Bachelor of Science',
      university: 'Example University',
    },
    ['EducationalCredential', 'DegreeCredential']
  );
  console.log(`   Credential created: ${credential.id || 'N/A'}`);
  console.log(`   Credential type: ${credential.type.join(', ')}\n`);

  // 4. Holder stores the credential
  console.log('4. Holder storing credential...');
  const credentialId = await holder.storeCredential(credential);
  console.log(`   Credential stored with ID: ${credentialId}\n`);

  // 5. Holder creates a presentation
  console.log('5. Holder creating presentation...');
  const presentation = await holder.createPresentation([credentialId]);
  console.log(`   Presentation created with ${presentation.verifiableCredential.length} credential(s)\n`);

  // 6. Verifier verifies the presentation
  console.log('6. Verifier verifying presentation...');
  const verifier = new VCVerifier();
  const verificationResult = await verifier.verifyPresentation(presentation);
  
  if (verificationResult.valid) {
    console.log('   ✓ Presentation is VALID');
  } else {
    console.log('   ✗ Presentation is INVALID');
    if (verificationResult.errors) {
      console.log(`   Errors: ${verificationResult.errors.join(', ')}`);
    }
  }
  
  if (verificationResult.warnings) {
    console.log(`   Warnings: ${verificationResult.warnings.join(', ')}`);
  }
  console.log();

  // 7. Demonstrate selective disclosure
  console.log('7. Holder creating presentation with selective disclosure...');
  const selectivePresentation = await holder.createPresentation([credentialId], {
    selectiveDisclosure: true,
    fieldsToDisclose: ['name', 'degree'], // Only disclose name and degree
  });
  console.log(`   Selective presentation created`);
  console.log(`   Disclosed fields: name, degree`);
  console.log(`   Hidden fields: email, university\n`);

  // 8. Verify selective presentation
  console.log('8. Verifier verifying selective presentation...');
  const selectiveVerification = await verifier.verifyPresentation(selectivePresentation);
  if (selectiveVerification.valid) {
    console.log('   ✓ Selective presentation is VALID\n');
  } else {
    console.log('   ✗ Selective presentation is INVALID\n');
  }
}

// Run the example
basicFlow().catch(console.error);

