// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./utils/TestSetup.sol";
import "../src/BridgeCore.sol";
import "../src/TokenVault.sol";

contract TokenVaultTest is TestSetup {
    BridgeCore public bridgeCore;
    TokenVault public vault;
    
    function setUp() public override {
        super.setUp();
        
        bridgeCore = new BridgeCore();
        bridgeCore.initialize(getGuardianAddresses(), governance);
        
        vault = new TokenVault(address(bridgeCore));
        
        vm.prank(user);
        usdc.approve(address(vault), type(uint256).max);
    }
    
    function testLockTokens_Success() public {
        uint256 amount = 1000 * 10**6;
        
        uint256 userBalanceBefore = usdc.balanceOf(user);
        uint256 vaultBalanceBefore = usdc.balanceOf(address(vault));
        
        vm.prank(user);
        bytes32 transferId = vault.lockTokens{value: MESSAGE_FEE}(
            address(usdc),
            amount,
            2,
            addressToBytes32(address(0x123))
        );
        
        assertEq(usdc.balanceOf(user), userBalanceBefore - amount);
        assertEq(usdc.balanceOf(address(vault)), vaultBalanceBefore + amount);
        assertTrue(transferId != bytes32(0));
    }
    
    function testLockTokens_InsufficientAllowance() public {
        uint256 amount = 1000 * 10**6;
        
        vm.startPrank(user2);
        vm.expectRevert();
        vault.lockTokens{value: MESSAGE_FEE}(address(usdc), amount, 2, addressToBytes32(address(0x123)));
        vm.stopPrank();
    }
    
    function testLockTokens_InsufficientBalance() public {
        uint256 amount = 20_000_000 * 10**6;
        
        vm.prank(user);
        vm.expectRevert();
        vault.lockTokens{value: MESSAGE_FEE}(address(usdc), amount, 2, addressToBytes32(address(0x123)));
    }
    
    function testLockTokens_ExceedsSingleLimit() public {
        uint256 amount = 2_000_000 * 10**6;
        
        vm.prank(user);
        vm.expectRevert(ITokenVault.ExceedsRateLimit.selector);
        vault.lockTokens{value: MESSAGE_FEE}(address(usdc), amount, 2, addressToBytes32(address(0x123)));
    }
    
    function testLockTokens_ExceedsDailyLimit() public {
        uint256 amount1 = 500_000 * 10**6;
        uint256 amount2 = 9_600_000 * 10**6;
        
        vm.startPrank(user);
        
        vault.lockTokens{value: MESSAGE_FEE}(address(usdc), amount1, 2, addressToBytes32(address(0x123)));
        
        vm.expectRevert(ITokenVault.ExceedsRateLimit.selector);
        vault.lockTokens{value: MESSAGE_FEE}(address(usdc), amount2, 2, addressToBytes32(address(0x123)));
        
        vm.stopPrank();
    }
    
    function testLockTokens_InsufficientFee() public {
        uint256 amount = 1000 * 10**6;
        
        vm.prank(user);
        vm.expectRevert();
        vault.lockTokens{value: 0}(address(usdc), amount, 2, addressToBytes32(address(0x123)));
    }
    
    function testLockTokens_InvalidChainId() public {
        uint256 amount = 1000 * 10**6;
        
        vm.prank(user);
        vm.expectRevert(ITokenVault.InvalidChainId.selector);
        vault.lockTokens{value: MESSAGE_FEE}(address(usdc), amount, 0, addressToBytes32(address(0x123)));
    }
    
    function testLockTokens_WhenPaused() public {
        uint256 amount = 1000 * 10**6;
        
        vm.prank(governance);
        bridgeCore.setPaused(true);
        
        vm.prank(user);
        vm.expectRevert(ITokenVault.BridgePaused.selector);
        vault.lockTokens{value: MESSAGE_FEE}(address(usdc), amount, 2, addressToBytes32(address(0x123)));
    }
    
    function testLockTokens_ZeroAmount() public {
        vm.prank(user);
        vm.expectRevert();
        vault.lockTokens{value: MESSAGE_FEE}(address(usdc), 0, 2, addressToBytes32(address(0x123)));
    }
    
    function testLockTokens_MaxAmount() public {
        uint256 amount = 1_000_000 * 10**6;
        
        vm.prank(user);
        bytes32 transferId = vault.lockTokens{value: MESSAGE_FEE}(
            address(usdc),
            amount,
            2,
            addressToBytes32(address(0x123))
        );
        
        assertTrue(transferId != bytes32(0));
    }
    
    function testUnlockTokens_Success() public {
        uint256 lockAmount = 1000 * 10**6;
        
        vm.prank(user);
        vault.lockTokens{value: MESSAGE_FEE}(address(usdc), lockAmount, 2, addressToBytes32(user2));
        
        bytes memory vaa = buildTokenTransferVAA(
            address(usdc),
            lockAmount,
            2,
            addressToBytes32(user2),
            uint16(block.chainid),
            address(usdc),
            uint64(lockAmount),
            1,
            1,
            address(vault),
            0
        );
        
        uint256 balanceBefore = usdc.balanceOf(user2);
        
        vault.unlockTokens(vaa);
        
        assertEq(usdc.balanceOf(user2), balanceBefore + lockAmount);
    }
    
    function testUnlockTokens_InvalidVAA() public {
        bytes memory invalidVAA = hex"0001";
        
        vm.expectRevert();
        vault.unlockTokens(invalidVAA);
    }
    
    function testUnlockTokens_ConsumedVAA() public {
        uint256 lockAmount = 1000 * 10**6;
        
        vm.prank(user);
        vault.lockTokens{value: MESSAGE_FEE}(address(usdc), lockAmount, 2, addressToBytes32(user2));
        
        bytes memory vaa = buildTokenTransferVAA(
            address(usdc),
            lockAmount,
            2,
            addressToBytes32(user2),
            uint16(block.chainid),
            address(usdc),
            uint64(lockAmount),
            1,
            1,
            address(vault),
            0
        );
        
        vault.unlockTokens(vaa);
        
        vm.expectRevert();
        vault.unlockTokens(vaa);
    }
    
    function testUnlockTokens_InsufficientBalance() public {
        bytes memory vaa = buildTokenTransferVAA(
            address(usdc),
            1000 * 10**6,
            2,
            addressToBytes32(user2),
            uint16(block.chainid),
            address(usdc),
            uint64(1000 * 10**6),
            1,
            1,
            address(vault),
            0
        );
        
        vm.expectRevert();
        vault.unlockTokens(vaa);
    }
    
    function testUnlockTokens_InvalidToken() public {
        uint256 lockAmount = 1000 * 10**6;
        
        vm.prank(user);
        vault.lockTokens{value: MESSAGE_FEE}(address(usdc), lockAmount, 2, addressToBytes32(user2));
        
        bytes memory vaa = buildTokenTransferVAA(
            address(usdt),
            lockAmount,
            2,
            addressToBytes32(user2),
            uint16(block.chainid),
            address(usdt),
            uint64(lockAmount),
            1,
            1,
            address(vault),
            0
        );
        
        vm.expectRevert();
        vault.unlockTokens(vaa);
    }
    
    function testUnlockTokens_WhenPaused() public {
        uint256 lockAmount = 1000 * 10**6;
        
        vm.prank(user);
        vault.lockTokens{value: MESSAGE_FEE}(address(usdc), lockAmount, 2, addressToBytes32(user2));
        
        bytes memory vaa = buildTokenTransferVAA(
            address(usdc),
            lockAmount,
            2,
            addressToBytes32(user2),
            uint16(block.chainid),
            address(usdc),
            uint64(lockAmount),
            1,
            1,
            address(vault),
            0
        );
        
        vm.prank(governance);
        bridgeCore.setPaused(true);
        
        vm.expectRevert(ITokenVault.BridgePaused.selector);
        vault.unlockTokens(vaa);
    }
    
    function testRateLimit_SingleLimitBoundary() public {
        uint256 amount = 1_000_000 * 10**6;
        
        vm.prank(user);
        bytes32 transferId = vault.lockTokens{value: MESSAGE_FEE}(
            address(usdc),
            amount,
            2,
            addressToBytes32(address(0x123))
        );
        
        assertTrue(transferId != bytes32(0));
    }
    
    function testRateLimit_SingleLimitPlusOne() public {
        uint256 amount = 1_000_001 * 10**6;
        
        vm.prank(user);
        vm.expectRevert(ITokenVault.ExceedsRateLimit.selector);
        vault.lockTokens{value: MESSAGE_FEE}(address(usdc), amount, 2, addressToBytes32(address(0x123)));
    }
    
    function testRateLimit_DailyLimitReached() public {
        uint256 amount = 1_000_000 * 10**6;
        
        vm.startPrank(user);
        
        for (uint i = 0; i < 10; i++) {
            vault.lockTokens{value: MESSAGE_FEE}(address(usdc), amount, 2, addressToBytes32(address(0x123)));
        }
        
        vm.stopPrank();
    }
    
    function testRateLimit_DailyLimitExceeded() public {
        uint256 amount = 1_000_000 * 10**6;
        
        vm.startPrank(user);
        
        for (uint i = 0; i < 10; i++) {
            vault.lockTokens{value: MESSAGE_FEE}(address(usdc), amount, 2, addressToBytes32(address(0x123)));
        }
        
        vm.expectRevert(ITokenVault.ExceedsRateLimit.selector);
        vault.lockTokens{value: MESSAGE_FEE}(address(usdc), amount, 2, addressToBytes32(address(0x123)));
        
        vm.stopPrank();
    }
    
    function testRateLimit_ResetAfter24Hours() public {
        uint256 amount = 1_000_000 * 10**6;
        
        vm.startPrank(user);
        
        for (uint i = 0; i < 10; i++) {
            vault.lockTokens{value: MESSAGE_FEE}(address(usdc), amount, 2, addressToBytes32(address(0x123)));
        }
        
        vm.warp(block.timestamp + 1 days + 1);
        
        bytes32 transferId = vault.lockTokens{value: MESSAGE_FEE}(
            address(usdc),
            amount,
            2,
            addressToBytes32(address(0x123))
        );
        
        assertTrue(transferId != bytes32(0));
        
        vm.stopPrank();
    }
}

