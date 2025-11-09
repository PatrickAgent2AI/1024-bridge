// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./utils/TestSetup.sol";
import "../src/BridgeCore.sol";
import "../src/TokenVault.sol";

contract AdminFunctionsTest is TestSetup {
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
    
    function testSetPaused_ByGovernance() public {
        vm.prank(governance);
        bridgeCore.setPaused(true);
        
        assertTrue(bridgeCore.paused());
    }
    
    function testSetPaused_NotGovernance() public {
        vm.prank(user);
        vm.expectRevert(IBridgeCore.Unauthorized.selector);
        bridgeCore.setPaused(true);
    }
    
    function testSetPaused_Unpause() public {
        vm.startPrank(governance);
        
        bridgeCore.setPaused(true);
        assertTrue(bridgeCore.paused());
        
        bridgeCore.setPaused(false);
        assertFalse(bridgeCore.paused());
        
        vm.stopPrank();
    }
    
    function testSetRateLimit_Success() public {
        uint256 newMaxSingle = 500_000 * 10**6;
        uint256 newMaxDaily = 5_000_000 * 10**6;
        
        vm.prank(governance);
        vault.setRateLimit(newMaxSingle, newMaxDaily);
        
        assertEq(vault.maxSingleTransfer(), newMaxSingle);
        assertEq(vault.maxDailyTransfer(), newMaxDaily);
    }
    
    function testSetRateLimit_NotGovernance() public {
        uint256 newMaxSingle = 500_000 * 10**6;
        uint256 newMaxDaily = 5_000_000 * 10**6;
        
        vm.prank(user);
        vm.expectRevert(ITokenVault.Unauthorized.selector);
        vault.setRateLimit(newMaxSingle, newMaxDaily);
    }
    
    function testWithdrawFees_Success() public {
        vm.prank(user);
        vault.lockTokens{value: MESSAGE_FEE}(address(usdc), 1000 * 10**6, 2, addressToBytes32(address(0x123)));
        
        uint256 vaultBalance = address(vault).balance;
        uint256 govBalanceBefore = governance.balance;
        
        vm.prank(governance);
        vault.withdrawFees(governance, vaultBalance);
        
        assertEq(governance.balance, govBalanceBefore + vaultBalance);
        assertEq(address(vault).balance, 0);
    }
    
    function testWithdrawFees_NotGovernance() public {
        vm.prank(user);
        vault.lockTokens{value: MESSAGE_FEE}(address(usdc), 1000 * 10**6, 2, addressToBytes32(address(0x123)));
        
        vm.prank(user);
        vm.expectRevert(ITokenVault.Unauthorized.selector);
        vault.withdrawFees(user, 0);
    }
    
    function testWithdrawFees_ExceedsBalance() public {
        vm.prank(user);
        vault.lockTokens{value: MESSAGE_FEE}(address(usdc), 1000 * 10**6, 2, addressToBytes32(address(0x123)));
        
        uint256 vaultBalance = address(vault).balance;
        
        vm.prank(governance);
        vm.expectRevert(ITokenVault.InsufficientBalance.selector);
        vault.withdrawFees(governance, vaultBalance + 1 ether);
    }
}

