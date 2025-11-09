// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IBridgeCore.sol";

contract BridgeCore is IBridgeCore {
    uint256 public constant MESSAGE_FEE = 0.001 ether;
    uint8 public constant QUORUM = 13;
    uint8 public constant TOTAL_GUARDIANS = 19;
    uint32 public constant GUARDIAN_SET_EXPIRATION_TIME = 7 days;
    
    address public governance;
    bool public paused;
    uint32 public currentGuardianSetIndex;
    uint64 public nextSequence;
    
    mapping(uint32 => GuardianSet) public guardianSets;
    mapping(address => uint64) public sequences;
    mapping(bytes32 => bool) public consumedVAAs;
    
    constructor() {
        governance = msg.sender;
    }
    
    function initialize(address[] memory initialGuardians, address _governance) external {
        require(guardianSets[0].keys.length == 0, "Already initialized");
        guardianSets[0] = GuardianSet({
            keys: initialGuardians,
            expirationTime: 0
        });
        governance = _governance;
    }
    
    function publishMessage(
        uint32 nonce,
        bytes memory payload,
        uint8 consistencyLevel
    ) external payable returns (uint64 sequence) {
        if (msg.value < MESSAGE_FEE) revert InsufficientFee();
        if (paused) revert BridgePaused();
        
        sequence = sequences[msg.sender]++;
        
        emit LogMessagePublished(msg.sender, sequence, nonce, payload, consistencyLevel);
        
        return sequence;
    }
    
    function receiveMessage(bytes memory encodedVAA) external returns (bool) {
        bytes32 vaaHash = keccak256(encodedVAA);
        if (consumedVAAs[vaaHash]) revert VAAAlreadyConsumed();
        
        _verifyVAA(encodedVAA);
        
        consumedVAAs[vaaHash] = true;
        
        (uint16 emitterChain, uint64 sequence) = _parseVAA(encodedVAA);
        
        emit MessageReceived(vaaHash, emitterChain, sequence);
        
        return true;
    }
    
    function getCurrentGuardianSetIndex() external view returns (uint32) {
        return currentGuardianSetIndex;
    }
    
    function getGuardianSet(uint32 index) external view returns (GuardianSet memory) {
        return guardianSets[index];
    }
    
    function isVAAConsumed(bytes32 vaaHash) external view returns (bool) {
        return consumedVAAs[vaaHash];
    }
    
    function updateGuardianSet(bytes memory vaa) external {
        if (msg.sender != governance) revert Unauthorized();
    }
    
    function setPaused(bool _paused) external {
        if (msg.sender != governance) revert Unauthorized();
        paused = _paused;
    }
    
    function messageFee() external pure returns (uint256) {
        return MESSAGE_FEE;
    }
    
    function _verifyVAA(bytes memory vaa) internal view {
        if (vaa.length < 6) revert InvalidVAA();
        
        uint8 version = uint8(vaa[0]);
        if (version != 1) revert InvalidVAA();
        
        uint32 guardianSetIndex = (uint32(uint8(vaa[1])) << 24) |
                                    (uint32(uint8(vaa[2])) << 16) |
                                    (uint32(uint8(vaa[3])) << 8) |
                                    uint32(uint8(vaa[4]));
        uint8 sigCount = uint8(vaa[5]);
        
        if (sigCount < QUORUM) revert InsufficientSignatures();
        
        GuardianSet storage guardianSet = guardianSets[guardianSetIndex];
        if (guardianSet.keys.length == 0) revert InvalidGuardianSet();
        if (guardianSet.expirationTime != 0 && guardianSet.expirationTime < block.timestamp) {
            revert InvalidGuardianSet();
        }
        
        uint256 offset = 6;
        bytes memory body = new bytes(vaa.length - offset - sigCount * 66);
        for (uint i = 0; i < body.length; i++) {
            body[i] = vaa[offset + sigCount * 66 + i];
        }
        
        bytes32 bodyHash = keccak256(abi.encodePacked(keccak256(body)));
        
        for (uint i = 0; i < sigCount; i++) {
            uint256 sigOffset = offset + i * 66;
            uint8 guardianIndex = uint8(vaa[sigOffset]);
            
            bytes32 r;
            bytes32 s;
            uint8 v;
            
            assembly {
                let vaaPtr := add(vaa, 32)
                r := mload(add(vaaPtr, add(sigOffset, 1)))
                s := mload(add(vaaPtr, add(sigOffset, 33)))
                v := byte(0, mload(add(vaaPtr, add(sigOffset, 65))))
            }
            
            address signer = ecrecover(bodyHash, v, r, s);
            if (signer != guardianSet.keys[guardianIndex]) revert InvalidSignature();
        }
    }
    
    function _parseVAA(bytes memory vaa) internal pure returns (uint16 emitterChain, uint64 sequence) {
        uint8 sigCount = uint8(vaa[5]);
        uint256 offset = 6 + sigCount * 66 + 8;
        
        emitterChain = (uint16(uint8(vaa[offset])) << 8) | uint16(uint8(vaa[offset + 1]));
        
        uint256 seqOffset = offset + 34;
        sequence = (uint64(uint8(vaa[seqOffset])) << 56) |
                   (uint64(uint8(vaa[seqOffset + 1])) << 48) |
                   (uint64(uint8(vaa[seqOffset + 2])) << 40) |
                   (uint64(uint8(vaa[seqOffset + 3])) << 32) |
                   (uint64(uint8(vaa[seqOffset + 4])) << 24) |
                   (uint64(uint8(vaa[seqOffset + 5])) << 16) |
                   (uint64(uint8(vaa[seqOffset + 6])) << 8) |
                   uint64(uint8(vaa[seqOffset + 7]));
    }
}

