// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ITokenVault {
    event TokensLocked(
        bytes32 indexed transferId,
        address indexed token,
        address indexed sender,
        uint256 amount,
        uint16 targetChain,
        bytes32 recipient
    );
    
    event TokensUnlocked(
        bytes32 indexed transferId,
        address indexed token,
        address indexed recipient,
        uint256 amount
    );
    
    event RateLimitUpdated(
        uint256 maxPerTransaction,
        uint256 maxPerDay,
        uint256 timestamp
    );
    
    error ExceedsRateLimit();
    error InsufficientBalance();
    error InvalidToken();
    error InvalidChainId();
    error InvalidRecipient();
    error TransferFailed();
    error BridgePaused();
    error Unauthorized();
    
    function lockTokens(
        address token,
        uint256 amount,
        uint16 targetChainId,
        bytes32 recipient
    ) external payable returns (bytes32 transferId);
    
    function unlockTokens(bytes memory vaa) external returns (bool success);
    
    function setRateLimit(uint256 maxPerTransaction, uint256 maxPerDay) external;
    
    function withdrawFees(address recipient, uint256 amount) external;
}

