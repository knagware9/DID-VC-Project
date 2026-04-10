/**
 * Smart contract ABIs for DIDRegistry and VCRegistry
 * These correspond to the Solidity contracts in src/contracts/
 */

export const DID_REGISTRY_ABI = [
  'function registerDID(string memory did, string memory publicKeyHex) external',
  'function updateDID(string memory did, string memory newPublicKeyHex) external',
  'function deactivateDID(string memory did) external',
  'function resolveDID(string memory did) external view returns (string didString, string publicKeyHex, address controller, bool active, uint256 createdAt, uint256 updatedAt)',
  'function isDIDActive(string memory did) external view returns (bool)',
  'function getDIDsByController(address controller) external view returns (string[] memory)',
  'event DIDRegistered(string indexed did, address indexed controller, uint256 timestamp)',
  'event DIDUpdated(string indexed did, uint256 timestamp)',
  'event DIDDeactivated(string indexed did, uint256 timestamp)',
];

export const VC_REGISTRY_ABI = [
  'function issueVC(string memory vcId, bytes32 vcHash, string memory issuerDid, string memory holderDid, string memory credentialType, uint256 expiresAt) external',
  'function revokeVC(string memory vcId) external',
  'function verifyVC(string memory vcId, bytes32 vcHash) external view returns (bool hashValid, bool isRevoked, bool isExpired, bool exists)',
  'function getVC(string memory vcId) external view returns (bytes32 vcHash, string memory issuerDid, string memory holderDid, string memory credentialType, uint256 issuedAt, uint256 expiresAt, bool revoked)',
  'function getVCsByIssuer(string memory issuerDid) external view returns (string[] memory)',
  'function isRevoked(string memory vcId) external view returns (bool)',
  'event VCIssued(string indexed vcId, string indexed issuerDid, string indexed holderDid, bytes32 vcHash, uint256 timestamp)',
  'event VCRevoked(string indexed vcId, address indexed revokedBy, uint256 timestamp)',
];
