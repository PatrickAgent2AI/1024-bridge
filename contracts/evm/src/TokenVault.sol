// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/ITokenVault.sol";
import "./interfaces/IBridgeCore.sol";

contract TokenVault is ITokenVault, ReentrancyGuard {
    using SafeERC20 for IERC20;
    
    IBridgeCore public immutable bridgeCore;
    address public governance;
    
    uint256 public maxSingleTransfer = 1_000_000 * 10**6;
    uint256 public maxDailyTransfer = 10_000_000 * 10**6;
    
    mapping(address => uint256) public lockedBalances;
    mapping(address => uint256) public dailyTransferred;
    mapping(address => uint256) public lastResetTime;
    
    constructor(address _bridgeCore) {
        bridgeCore = IBridgeCore(_bridgeCore);
        governance = msg.sender;
    }
    
    function lockTokens(
        address token,
        uint256 amount,
        uint16 targetChainId,
        bytes32 recipient
    ) external payable nonReentrant returns (bytes32 transferId) {
        if (bridgeCore.paused()) revert BridgePaused();
        if (targetChainId == 0 || targetChainId == block.chainid) revert InvalidChainId();
        if (recipient == bytes32(0)) revert InvalidRecipient();
        if (amount > maxSingleTransfer) revert ExceedsRateLimit();
        
        _checkDailyLimit(token, amount);
        
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        lockedBalances[token] += amount;
        
        bytes memory payload = abi.encodePacked(
            uint8(1),
            amount,
            bytes32(uint256(uint160(token))),
            uint16(block.chainid),
            recipient,
            targetChainId,
            bytes32(0),
            uint64(amount),
            uint64(1),
            uint64(1)
        );
        
        uint64 sequence = bridgeCore.publishMessage{value: msg.value}(
            uint32(block.timestamp),
            payload,
            200
        );
        
        transferId = keccak256(abi.encodePacked(block.chainid, address(this), sequence));
        
        emit TokensLocked(transferId, token, msg.sender, amount, targetChainId, recipient);
        
        return transferId;
    }
    
    function unlockTokens(bytes memory vaa) external nonReentrant returns (bool) {
        if (bridgeCore.paused()) revert BridgePaused();
        
        bool success = bridgeCore.receiveMessage(vaa);
        require(success, "VAA verification failed");
        
        (address token, address recipient, uint256 amount) = _parseTransferPayload(vaa);
        
        if (lockedBalances[token] < amount) revert InsufficientBalance();
        
        lockedBalances[token] -= amount;
        IERC20(token).safeTransfer(recipient, amount);
        
        bytes32 vaaHash = keccak256(vaa);
        bytes32 transferId = keccak256(abi.encodePacked(vaaHash, token, recipient));
        
        emit TokensUnlocked(transferId, token, recipient, amount);
        
        return true;
    }
    
    function setRateLimit(uint256 maxPerTransaction, uint256 maxPerDay) external {
        if (msg.sender != governance) revert Unauthorized();
        maxSingleTransfer = maxPerTransaction;
        maxDailyTransfer = maxPerDay;
        
        emit RateLimitUpdated(maxPerTransaction, maxPerDay, block.timestamp);
    }
    
    function withdrawFees(address recipient, uint256 amount) external {
        if (msg.sender != governance) revert Unauthorized();
        
        uint256 balance = address(this).balance;
        uint256 withdrawAmount = amount == 0 ? balance : amount;
        
        if (withdrawAmount > balance) revert InsufficientBalance();
        
        payable(recipient).transfer(withdrawAmount);
    }
    
    function _checkDailyLimit(address token, uint256 amount) internal {
        if (block.timestamp >= lastResetTime[token] + 1 days) {
            dailyTransferred[token] = 0;
            lastResetTime[token] = block.timestamp;
        }
        
        if (dailyTransferred[token] + amount > maxDailyTransfer) revert ExceedsRateLimit();
        
        dailyTransferred[token] += amount;
    }
    
    function _parseTransferPayload(bytes memory vaa) internal pure returns (
        address token,
        address recipient,
        uint256 amount
    ) {
        uint8 sigCount = uint8(vaa[5]);
        uint256 offset = 6 + sigCount * 66 + 51;
        
        bytes memory payload = new bytes(vaa.length - offset);
        for (uint i = 0; i < payload.length; i++) {
            payload[i] = vaa[offset + i];
        }
        
        require(uint8(payload[0]) == 1, "Invalid payload type");
        
        bytes32 amountBytes;
        bytes32 tokenBytes;
        bytes32 recipientBytes;
        
        assembly {
            amountBytes := mload(add(payload, 33))
            tokenBytes := mload(add(payload, 65))
            recipientBytes := mload(add(payload, 99))
        }
        
        amount = uint256(amountBytes);
        token = address(uint160(uint256(tokenBytes)));
        recipient = address(uint160(uint256(recipientBytes)));
    }
}

