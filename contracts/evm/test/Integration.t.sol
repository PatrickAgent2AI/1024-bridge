// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./utils/TestSetup.sol";
import "../src/BridgeCore.sol";
import "../src/TokenVault.sol";

contract IntegrationTest is TestSetup {
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
    
    function testFullCrossChainFlow() public {
        uint256 amount = 1000 * 10**6;
        
        vm.prank(user);
        bytes32 transferId = vault.lockTokens{value: MESSAGE_FEE}(
            address(usdc),
            amount,
            2,
            addressToBytes32(user2)
        );
        
        assertEq(usdc.balanceOf(address(vault)), amount);
        assertTrue(transferId != bytes32(0));
        
        bytes memory vaa = buildTokenTransferVAA(
            address(usdc),
            amount,
            uint16(block.chainid),
            addressToBytes32(user2),
            2,
            address(usdc),
            uint64(amount),
            1,
            1,
            address(vault),
            0
        );
        
        bool success = bridgeCore.receiveMessage(vaa);
        assertTrue(success);
        
        bytes32 vaaHash = keccak256(vaa);
        assertTrue(bridgeCore.isVAAConsumed(vaaHash));
    }
    
    function testTokenBindingFlow() public {
        uint256 amount = 1000 * 10**6;
        
        vm.prank(user);
        vault.lockTokens{value: MESSAGE_FEE}(address(usdc), amount, 2, addressToBytes32(user2));
        
        bytes memory vaa = buildTokenTransferVAA(
            address(usdc),
            amount,
            uint16(block.chainid),
            addressToBytes32(user2),
            2,
            address(usdc),
            uint64(amount),
            1,
            1,
            address(vault),
            0
        );
        
        vault.unlockTokens(vaa);
        
        assertEq(usdc.balanceOf(user2), 10_000_000 * 10**6 + amount);
    }
    
    function testMultipleRoundTrips() public {
        uint256 amount = 100 * 10**6;
        
        vm.startPrank(user);
        
        for (uint i = 0; i < 3; i++) {
            vault.lockTokens{value: MESSAGE_FEE}(address(usdc), amount, 2, addressToBytes32(user2));
            
            bytes memory vaa = buildTokenTransferVAA(
                address(usdc),
                amount,
                2,
                addressToBytes32(user),
                uint16(block.chainid),
                address(usdc),
                uint64(amount),
                1,
                1,
                address(vault),
                uint64(i)
            );
            
            vault.unlockTokens(vaa);
        }
        
        vm.stopPrank();
        
        assertEq(usdc.balanceOf(user), 10_000_000 * 10**6);
    }
    
    function testGuardianSetUpgrade() public {
        bytes memory payload = hex"0102030405";
        bytes memory vaa = buildValidVAA(0, GUARDIAN_QUORUM, payload, 123, 1, address(this), 0);
        
        vm.prank(governance);
        bridgeCore.updateGuardianSet(vaa);
    }
    
    function testGuardianSetUpgrade_TransitionOldSet() public {
        bytes memory payload = hex"0102030405";
        bytes memory vaa = buildValidVAA(0, GUARDIAN_QUORUM, payload, 123, 1, address(this), 0);
        
        bool success = bridgeCore.receiveMessage(vaa);
        assertTrue(success);
    }
    
    function testGuardianSetUpgrade_TransitionNewSet() public {
        bytes memory payload = hex"0102030405";
        bytes memory vaa = buildValidVAA(0, GUARDIAN_QUORUM, payload, 123, 1, address(this), 0);
        
        bool success = bridgeCore.receiveMessage(vaa);
        assertTrue(success);
    }
    
    function testGuardianSetUpgrade_AfterExpiration() public {
        bytes memory payload = hex"0102030405";
        bytes memory vaa = buildValidVAA(0, GUARDIAN_QUORUM, payload, 123, 1, address(this), 0);
        
        vm.warp(block.timestamp + 8 days);
        
        vm.expectRevert();
        bridgeCore.receiveMessage(vaa);
    }
    
    function testVAADuplicateSubmission() public {
        bytes memory payload = hex"0102030405";
        bytes memory vaa = buildValidVAA(0, GUARDIAN_QUORUM, payload, 123, 1, address(this), 0);
        
        bridgeCore.receiveMessage(vaa);
        
        vm.expectRevert(IBridgeCore.VAAAlreadyConsumed.selector);
        bridgeCore.receiveMessage(vaa);
    }
    
    function testGasFailureRecovery() public {
        bytes memory payload = hex"0102030405";
        bytes memory vaa = buildValidVAA(0, GUARDIAN_QUORUM, payload, 123, 1, address(this), 0);
        
        bool success = bridgeCore.receiveMessage(vaa);
        assertTrue(success);
    }
    
    function testPauseDuringOperation() public {
        uint256 amount = 1000 * 10**6;
        
        vm.prank(governance);
        bridgeCore.setPaused(true);
        
        vm.prank(user);
        vm.expectRevert(ITokenVault.BridgePaused.selector);
        vault.lockTokens{value: MESSAGE_FEE}(address(usdc), amount, 2, addressToBytes32(user2));
    }
    
    function testMultiContractConcurrency() public {
        uint256 amount = 100 * 10**6;
        
        vm.prank(user);
        vault.lockTokens{value: MESSAGE_FEE}(address(usdc), amount, 2, addressToBytes32(user2));
        
        vm.prank(user2);
        usdc.approve(address(vault), type(uint256).max);
        
        vm.prank(user2);
        vault.lockTokens{value: MESSAGE_FEE}(address(usdc), amount, 2, addressToBytes32(user));
        
        assertEq(usdc.balanceOf(address(vault)), amount * 2);
    }
    
    function testCrossChainExchangeFlow() public {
        uint256 sourceAmount = 1000 * 10**6;
        uint64 targetAmount = 998 * 10**6;
        
        vm.prank(user);
        vault.lockTokens{value: MESSAGE_FEE}(address(usdc), sourceAmount, 2, addressToBytes32(user2));
        
        bytes memory vaa = buildTokenTransferVAA(
            address(usdc),
            sourceAmount,
            2,
            addressToBytes32(user2),
            uint16(block.chainid),
            address(usdt),
            targetAmount,
            998,
            1000,
            address(vault),
            0
        );
        
        vm.expectRevert();
        vault.unlockTokens(vaa);
    }
    
    function testMultiTokenSupport() public {
        uint256 usdcAmount = 1000 * 10**6;
        uint256 wethAmount = 1 * 10**18;
        
        vm.startPrank(user);
        
        weth.approve(address(vault), type(uint256).max);
        
        vault.lockTokens{value: MESSAGE_FEE}(address(usdc), usdcAmount, 2, addressToBytes32(user2));
        
        vault.lockTokens{value: MESSAGE_FEE}(address(weth), wethAmount, 2, addressToBytes32(user2));
        
        vm.stopPrank();
        
        assertEq(usdc.balanceOf(address(vault)), usdcAmount);
        assertEq(weth.balanceOf(address(vault)), wethAmount);
    }
}

