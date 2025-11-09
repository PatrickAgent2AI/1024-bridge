// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IBridgeCore {
    struct GuardianSet {
        address[] keys;
        uint32 expirationTime;
    }
    
    event LogMessagePublished(
        address indexed sender,
        uint64 sequence,
        uint32 nonce,
        bytes payload,
        uint8 consistencyLevel
    );
    
    event MessageReceived(
        bytes32 indexed vaaHash,
        uint16 sourceChain,
        uint64 sequence
    );
    
    event GuardianSetUpdated(
        uint32 indexed oldIndex,
        uint32 indexed newIndex
    );
    
    error InsufficientFee();
    error InvalidVAA();
    error VAAAlreadyConsumed();
    error InvalidGuardianSet();
    error InsufficientSignatures();
    error InvalidSignature();
    error BridgePaused();
    error Unauthorized();
    
    function publishMessage(
        uint32 nonce,
        bytes memory payload,
        uint8 consistencyLevel
    ) external payable returns (uint64 sequence);
    
    function receiveMessage(bytes memory encodedVAA) external returns (bool success);
    
    function getCurrentGuardianSetIndex() external view returns (uint32 index);
    
    function getGuardianSet(uint32 index) external view returns (GuardianSet memory);
    
    function isVAAConsumed(bytes32 vaaHash) external view returns (bool);
    
    function updateGuardianSet(bytes memory vaa) external;
    
    function setPaused(bool paused) external;
    
    function messageFee() external view returns (uint256);
    
    function paused() external view returns (bool);
}

