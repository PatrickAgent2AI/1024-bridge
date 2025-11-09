// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library VAABuilder {
    struct Signature {
        uint8 guardianIndex;
        bytes32 r;
        bytes32 s;
        uint8 v;
    }
    
    function buildVAA(
        uint8 version,
        uint32 guardianSetIndex,
        Signature[] memory signatures,
        uint32 timestamp,
        uint32 nonce,
        uint16 emitterChain,
        bytes32 emitterAddress,
        uint64 sequence,
        uint8 consistencyLevel,
        bytes memory payload
    ) internal pure returns (bytes memory) {
        bytes memory signatureBytes = "";
        
        for (uint i = 0; i < signatures.length; i++) {
            signatureBytes = abi.encodePacked(
                signatureBytes,
                signatures[i].guardianIndex,
                signatures[i].r,
                signatures[i].s,
                signatures[i].v
            );
        }
        
        bytes memory body = abi.encodePacked(
            timestamp,
            nonce,
            emitterChain,
            emitterAddress,
            sequence,
            consistencyLevel,
            payload
        );
        
        return abi.encodePacked(
            version,
            guardianSetIndex,
            uint8(signatures.length),
            signatureBytes,
            body
        );
    }
    
    function buildTokenTransferPayload(
        uint256 amount,
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
    
    function getVAABody(bytes memory vaa) internal pure returns (bytes memory) {
        uint256 signaturesLen = uint8(vaa[5]);
        uint256 bodyOffset = 6 + signaturesLen * 66;
        
        bytes memory body = new bytes(vaa.length - bodyOffset);
        for (uint i = 0; i < body.length; i++) {
            body[i] = vaa[bodyOffset + i];
        }
        
        return body;
    }
    
    function getVAAHash(bytes memory vaa) internal pure returns (bytes32) {
        return keccak256(vaa);
    }
}

