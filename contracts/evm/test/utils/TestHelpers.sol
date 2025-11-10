// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

library TestHelpers {
    function toBytes32(address addr) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(addr)));
    }
    
    function toAddress(bytes32 b) internal pure returns (address) {
        return address(uint160(uint256(b)));
    }
    
    function generateGuardianKeys(uint8 count) internal returns (address[] memory, uint256[] memory) {
        address[] memory addresses = new address[](count);
        uint256[] memory privateKeys = new uint256[](count);
        
        for (uint8 i = 0; i < count; i++) {
            uint256 pk = uint256(keccak256(abi.encodePacked("guardian", i, block.timestamp)));
            addresses[i] = vm.addr(pk);
            privateKeys[i] = pk;
        }
        
        return (addresses, privateKeys);
    }
    
    function signMessageHash(bytes32 messageHash, uint256 privateKey) internal pure returns (bytes32 r, bytes32 s, uint8 v) {
        (v, r, s) = vm.sign(privateKey, messageHash);
    }
    
    function encodeTokenTransferPayload(
        uint64 amount,
        bytes32 tokenAddress,
        uint16 tokenChain,
        bytes32 recipient,
        uint16 recipientChain,
        bytes32 targetToken,
        uint64 targetAmount,
        uint64 exchangeRateNum,
        uint64 exchangeRateDenom
    ) internal pure returns (bytes memory) {
        return abi.encodePacked(
            uint8(1),
            amount,
            tokenAddress,
            tokenChain,
            recipient,
            recipientChain,
            targetToken,
            targetAmount,
            exchangeRateNum,
            exchangeRateDenom
        );
    }
    
    function calculateBodyHash(bytes memory body) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(keccak256(body)));
    }
}

contract VAABuilder is Test {
    struct VAAConfig {
        uint8 version;
        uint32 guardianSetIndex;
        uint32 timestamp;
        uint32 nonce;
        uint16 emitterChain;
        bytes32 emitterAddress;
        uint64 sequence;
        uint8 consistencyLevel;
        bytes payload;
    }
    
    function buildVAA(
        VAAConfig memory config,
        uint256[] memory guardianPrivateKeys,
        uint8 numSignatures
    ) public pure returns (bytes memory) {
        require(numSignatures <= guardianPrivateKeys.length, "Not enough guardians");
        
        bytes memory body = abi.encodePacked(
            config.timestamp,
            config.nonce,
            config.emitterChain,
            config.emitterAddress,
            config.sequence,
            config.consistencyLevel,
            config.payload
        );
        
        bytes32 bodyHash = TestHelpers.calculateBodyHash(body);
        
        bytes memory signatures = new bytes(0);
        for (uint8 i = 0; i < numSignatures; i++) {
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(guardianPrivateKeys[i], bodyHash);
            
            signatures = abi.encodePacked(
                signatures,
                uint8(i),
                r,
                s,
                v
            );
        }
        
        return abi.encodePacked(
            config.version,
            config.guardianSetIndex,
            uint8(numSignatures),
            signatures,
            body
        );
    }
    
    function buildTokenTransferVAA(
        uint32 guardianSetIndex,
        uint256[] memory guardianPrivateKeys,
        uint8 numSignatures,
        uint16 emitterChain,
        bytes32 emitterAddress,
        uint64 sequence,
        uint64 amount,
        bytes32 tokenAddress,
        uint16 tokenChain,
        bytes32 recipient,
        uint16 recipientChain,
        bytes32 targetToken,
        uint64 targetAmount,
        uint64 exchangeRateNum,
        uint64 exchangeRateDenom
    ) public pure returns (bytes memory) {
        bytes memory payload = TestHelpers.encodeTokenTransferPayload(
            amount,
            tokenAddress,
            tokenChain,
            recipient,
            recipientChain,
            targetToken,
            targetAmount,
            exchangeRateNum,
            exchangeRateDenom
        );
        
        VAAConfig memory config = VAAConfig({
            version: 1,
            guardianSetIndex: guardianSetIndex,
            timestamp: uint32(block.timestamp),
            nonce: 0,
            emitterChain: emitterChain,
            emitterAddress: emitterAddress,
            sequence: sequence,
            consistencyLevel: 200,
            payload: payload
        });
        
        return buildVAA(config, guardianPrivateKeys, numSignatures);
    }
}

