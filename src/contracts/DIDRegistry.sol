// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title DIDRegistry
 * @dev On-chain registry for Decentralized Identifiers (DIDs)
 * Compatible with W3C DID specification
 */
contract DIDRegistry {
    struct DIDDocument {
        string didString;
        string publicKeyHex;
        address controller;
        bool active;
        uint256 createdAt;
        uint256 updatedAt;
    }

    // did string => DIDDocument
    mapping(string => DIDDocument) public dids;
    // address => list of DIDs they control
    mapping(address => string[]) public controllerDIDs;

    event DIDRegistered(string indexed did, address indexed controller, uint256 timestamp);
    event DIDUpdated(string indexed did, uint256 timestamp);
    event DIDDeactivated(string indexed did, uint256 timestamp);

    modifier onlyController(string memory did) {
        require(dids[did].controller == msg.sender, "DIDRegistry: not the controller");
        _;
    }

    /**
     * @dev Register a new DID
     */
    function registerDID(
        string memory did,
        string memory publicKeyHex
    ) external {
        require(bytes(dids[did].didString).length == 0, "DIDRegistry: DID already registered");
        require(bytes(did).length > 0, "DIDRegistry: DID cannot be empty");

        dids[did] = DIDDocument({
            didString: did,
            publicKeyHex: publicKeyHex,
            controller: msg.sender,
            active: true,
            createdAt: block.timestamp,
            updatedAt: block.timestamp
        });

        controllerDIDs[msg.sender].push(did);
        emit DIDRegistered(did, msg.sender, block.timestamp);
    }

    /**
     * @dev Update a DID's public key
     */
    function updateDID(
        string memory did,
        string memory newPublicKeyHex
    ) external onlyController(did) {
        dids[did].publicKeyHex = newPublicKeyHex;
        dids[did].updatedAt = block.timestamp;
        emit DIDUpdated(did, block.timestamp);
    }

    /**
     * @dev Deactivate a DID
     */
    function deactivateDID(string memory did) external onlyController(did) {
        dids[did].active = false;
        dids[did].updatedAt = block.timestamp;
        emit DIDDeactivated(did, block.timestamp);
    }

    /**
     * @dev Resolve a DID document
     */
    function resolveDID(string memory did) external view returns (
        string memory didString,
        string memory publicKeyHex,
        address controller,
        bool active,
        uint256 createdAt,
        uint256 updatedAt
    ) {
        DIDDocument storage doc = dids[did];
        return (doc.didString, doc.publicKeyHex, doc.controller, doc.active, doc.createdAt, doc.updatedAt);
    }

    /**
     * @dev Check if a DID is registered and active
     */
    function isDIDActive(string memory did) external view returns (bool) {
        return dids[did].active && bytes(dids[did].didString).length > 0;
    }

    /**
     * @dev Get all DIDs controlled by an address
     */
    function getDIDsByController(address controller) external view returns (string[] memory) {
        return controllerDIDs[controller];
    }
}
