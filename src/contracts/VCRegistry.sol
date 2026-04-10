// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title VCRegistry
 * @dev On-chain registry for Verifiable Credential hashes and revocation
 * Stores only credential hashes (not full VCs) for privacy
 */
contract VCRegistry {
    struct VCRecord {
        bytes32 vcHash;         // keccak256 hash of the full VC JSON
        string issuerDid;
        string holderDid;
        string credentialType;
        uint256 issuedAt;
        uint256 expiresAt;
        bool revoked;
        address issuerAddress;
    }

    // vcId => VCRecord
    mapping(string => VCRecord) public credentials;
    // issuerDid => list of vcIds
    mapping(string => string[]) public issuerCredentials;
    // holderDid => list of vcIds
    mapping(string => string[]) public holderCredentials;

    event VCIssued(
        string indexed vcId,
        string indexed issuerDid,
        string indexed holderDid,
        bytes32 vcHash,
        uint256 timestamp
    );
    event VCRevoked(string indexed vcId, address indexed revokedBy, uint256 timestamp);

    modifier onlyIssuer(string memory vcId) {
        require(credentials[vcId].issuerAddress == msg.sender, "VCRegistry: not the issuer");
        _;
    }

    /**
     * @dev Anchor a Verifiable Credential hash on-chain
     */
    function issueVC(
        string memory vcId,
        bytes32 vcHash,
        string memory issuerDid,
        string memory holderDid,
        string memory credentialType,
        uint256 expiresAt
    ) external {
        require(bytes(credentials[vcId].issuerDid).length == 0, "VCRegistry: VC already exists");
        require(vcHash != bytes32(0), "VCRegistry: hash cannot be zero");

        credentials[vcId] = VCRecord({
            vcHash: vcHash,
            issuerDid: issuerDid,
            holderDid: holderDid,
            credentialType: credentialType,
            issuedAt: block.timestamp,
            expiresAt: expiresAt,
            revoked: false,
            issuerAddress: msg.sender
        });

        issuerCredentials[issuerDid].push(vcId);
        holderCredentials[holderDid].push(vcId);

        emit VCIssued(vcId, issuerDid, holderDid, vcHash, block.timestamp);
    }

    /**
     * @dev Revoke a Verifiable Credential
     */
    function revokeVC(string memory vcId) external onlyIssuer(vcId) {
        require(!credentials[vcId].revoked, "VCRegistry: already revoked");
        credentials[vcId].revoked = true;
        emit VCRevoked(vcId, msg.sender, block.timestamp);
    }

    /**
     * @dev Verify a credential: checks hash matches, not revoked, not expired
     * @return hashValid - provided hash matches stored hash
     * @return isRevoked - credential is revoked
     * @return isExpired - credential is expired
     * @return exists - credential exists on-chain
     */
    function verifyVC(
        string memory vcId,
        bytes32 vcHash
    ) external view returns (
        bool hashValid,
        bool isRevoked,
        bool isExpired,
        bool exists
    ) {
        VCRecord storage record = credentials[vcId];
        exists = bytes(record.issuerDid).length > 0;
        if (!exists) return (false, false, false, false);

        hashValid = record.vcHash == vcHash;
        isRevoked = record.revoked;
        isExpired = record.expiresAt > 0 && block.timestamp > record.expiresAt;
    }

    /**
     * @dev Get credential record
     */
    function getVC(string memory vcId) external view returns (
        bytes32 vcHash,
        string memory issuerDid,
        string memory holderDid,
        string memory credentialType,
        uint256 issuedAt,
        uint256 expiresAt,
        bool revoked
    ) {
        VCRecord storage r = credentials[vcId];
        return (r.vcHash, r.issuerDid, r.holderDid, r.credentialType, r.issuedAt, r.expiresAt, r.revoked);
    }

    /**
     * @dev Get all VC IDs issued by an issuer
     */
    function getVCsByIssuer(string memory issuerDid) external view returns (string[] memory) {
        return issuerCredentials[issuerDid];
    }

    /**
     * @dev Check if a credential is revoked
     */
    function isRevoked(string memory vcId) external view returns (bool) {
        return credentials[vcId].revoked;
    }
}
