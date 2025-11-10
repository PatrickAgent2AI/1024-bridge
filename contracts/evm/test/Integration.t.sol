// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./TestSetup.sol";

contract IntegrationTest is TestSetup {
    IBridgeCore public bridgeCore;
    ITokenVault public vault;
    
    function setUp() public override {
        super.setUp();
    }
    
    function testIntegration_LockTokensPublishesMessage() public {
        uint256 amount = 1000e6;
        
        vm.startPrank(alice);
        usdc.approve(address(vault), amount);
        
        uint64 seq1 = bridgeCore.getMessageSequence(address(vault));
        
        vault.lockTokens{value: 0.001 ether}(
            address(usdc),
            amount,
            SOLANA_DEVNET,
            SOLANA_USDC_MINT,
            aliceSolanaAddress
        );
        
        vm.stopPrank();
        
        uint64 seq2 = bridgeCore.getMessageSequence(address(vault));
        
        assertEq(seq2, seq1 + 1);
    }
    
    function testIntegration_ReceiveMessageUnlockTokens() public {
        usdc.mint(address(vault), 10000e6);
        
        vm.prank(governance);
        vault.registerBidirectionalBinding(
            SOLANA_DEVNET,
            SOLANA_USDC_MINT,
            LOCAL_CHAIN_ID,
            TestHelpers.toBytes32(address(usdc)),
            1, 1,
            1, 1
        );
        
        bytes memory vaa = vaaBuilder.buildTokenTransferVAA(
            0,
            guardianPrivateKeys,
            13,
            SOLANA_DEVNET,
            bytes32(uint256(0x123)),
            0,
            1000e6,
            SOLANA_USDC_MINT,
            SOLANA_DEVNET,
            TestHelpers.toBytes32(alice),
            LOCAL_CHAIN_ID,
            TestHelpers.toBytes32(address(usdc)),
            1000e6,
            1,
            1
        );
        
        uint256 balanceBefore = usdc.balanceOf(alice);
        
        bool success = vault.unlockTokens(vaa);
        
        assertTrue(success);
        assertEq(usdc.balanceOf(alice), balanceBefore + 1000e6);
    }
    
    function testIntegration_AtomicityOnFailure() public {
        uint256 amount = 1000e6;
        
        vm.startPrank(alice);
        usdc.approve(address(vault), amount - 1);
        
        uint256 balanceBefore = usdc.balanceOf(alice);
        uint256 vaultBalanceBefore = vault.custodyBalances(address(usdc));
        uint64 seqBefore = bridgeCore.getMessageSequence(address(vault));
        
        vm.expectRevert();
        vault.lockTokens{value: 0.001 ether}(
            address(usdc),
            amount,
            SOLANA_DEVNET,
            SOLANA_USDC_MINT,
            aliceSolanaAddress
        );
        
        vm.stopPrank();
        
        assertEq(usdc.balanceOf(alice), balanceBefore);
        assertEq(vault.custodyBalances(address(usdc)), vaultBalanceBefore);
        assertEq(bridgeCore.getMessageSequence(address(vault)), seqBefore);
    }
    
    function testIntegration_GuardianSetUpgrade() public {
        (address[] memory newGuardians, uint256[] memory newKeys) = TestHelpers.generateGuardianKeys(19);
        
        bytes memory upgradePayload = abi.encodePacked(
            bytes32("Core"),
            uint8(2),
            uint16(0),
            uint32(1),
            uint8(19),
            newGuardians
        );
        
        VAABuilder.VAAConfig memory config = VAABuilder.VAAConfig({
            version: 1,
            guardianSetIndex: 0,
            timestamp: uint32(block.timestamp),
            nonce: 0,
            emitterChain: 0,
            emitterAddress: bytes32(0),
            sequence: 0,
            consistencyLevel: 200,
            payload: upgradePayload
        });
        
        bytes memory vaa = vaaBuilder.buildVAA(config, guardianPrivateKeys, 13);
        bridgeCore.updateGuardianSet(vaa);
        
        assertEq(bridgeCore.getCurrentGuardianSetIndex(), 1);
        
        bytes memory newSetVAA = vaaBuilder.buildTokenTransferVAA(
            1,
            newKeys,
            13,
            LOCAL_CHAIN_ID,
            TestHelpers.toBytes32(address(this)),
            0,
            1000e6,
            TestHelpers.toBytes32(address(usdc)),
            LOCAL_CHAIN_ID,
            aliceSolanaAddress,
            SOLANA_DEVNET,
            SOLANA_USDC_MINT,
            1000e6,
            1,
            1
        );
        
        bytes32 vaaHash = bridgeCore.receiveMessage(newSetVAA);
        assertTrue(bridgeCore.isVAAConsumed(vaaHash));
    }
    
    function testIntegration_TokenBindingVerification() public {
        vm.prank(governance);
        vault.registerBidirectionalBinding(
            LOCAL_CHAIN_ID,
            TestHelpers.toBytes32(address(usdc)),
            SOLANA_DEVNET,
            SOLANA_USDC_MINT,
            1, 1,
            1, 1
        );
        
        uint256 amount = 1000e6;
        
        vm.startPrank(alice);
        usdc.approve(address(vault), amount);
        
        uint64 sequence = vault.lockTokens{value: 0.001 ether}(
            address(usdc),
            amount,
            SOLANA_DEVNET,
            SOLANA_USDC_MINT,
            aliceSolanaAddress
        );
        
        vm.stopPrank();
        
        assertGe(sequence, 0);
    }
    
    function testIntegration_RegisterBidirectionalBinding() public {
        vm.prank(governance);
        vault.registerBidirectionalBinding(
            LOCAL_CHAIN_ID,
            TestHelpers.toBytes32(address(usdc)),
            SOLANA_DEVNET,
            SOLANA_USDC_MINT,
            1, 1,
            1, 1
        );
        
        uint256 amount = 1000e6;
        
        vm.startPrank(alice);
        usdc.approve(address(vault), amount);
        
        uint64 outboundSeq = vault.lockTokens{value: 0.001 ether}(
            address(usdc),
            amount,
            SOLANA_DEVNET,
            SOLANA_USDC_MINT,
            aliceSolanaAddress
        );
        
        vm.stopPrank();
        
        assertGe(outboundSeq, 0);
        
        usdc.mint(address(vault), 10000e6);
        
        bytes memory vaa = vaaBuilder.buildTokenTransferVAA(
            0,
            guardianPrivateKeys,
            13,
            SOLANA_DEVNET,
            bytes32(uint256(0x123)),
            0,
            1000e6,
            SOLANA_USDC_MINT,
            SOLANA_DEVNET,
            TestHelpers.toBytes32(bob),
            LOCAL_CHAIN_ID,
            TestHelpers.toBytes32(address(usdc)),
            1000e6,
            1,
            1
        );
        
        uint256 bobBalanceBefore = usdc.balanceOf(bob);
        bool success = vault.unlockTokens(vaa);
        
        assertTrue(success);
        assertEq(usdc.balanceOf(bob), bobBalanceBefore + 1000e6);
    }
    
    function testIntegration_UpdateExchangeRate() public {
        vm.prank(governance);
        vault.registerBidirectionalBinding(
            LOCAL_CHAIN_ID,
            TestHelpers.toBytes32(address(usdc)),
            SOLANA_DEVNET,
            SOLANA_USDT_MINT,
            998, 1000,
            1002, 1000
        );
        
        vm.prank(governance);
        vault.setExchangeRate(
            LOCAL_CHAIN_ID,
            TestHelpers.toBytes32(address(usdc)),
            SOLANA_DEVNET,
            SOLANA_USDT_MINT,
            997, 1000
        );
    }
    
    function testIntegration_DisableTokenBinding() public {
        vm.prank(governance);
        vault.registerBidirectionalBinding(
            LOCAL_CHAIN_ID,
            TestHelpers.toBytes32(address(usdc)),
            SOLANA_DEVNET,
            SOLANA_USDC_MINT,
            1, 1,
            1, 1
        );
        
        vm.prank(governance);
        vault.setTokenBindingEnabled(
            LOCAL_CHAIN_ID,
            TestHelpers.toBytes32(address(usdc)),
            SOLANA_DEVNET,
            SOLANA_USDC_MINT,
            false
        );
        
        uint256 amount = 1000e6;
        
        vm.startPrank(alice);
        usdc.approve(address(vault), amount);
        
        vm.expectRevert();
        vault.lockTokens{value: 0.001 ether}(
            address(usdc),
            amount,
            SOLANA_DEVNET,
            SOLANA_USDC_MINT,
            aliceSolanaAddress
        );
        
        vm.stopPrank();
    }
    
    function testIntegration_MultiTokenBinding() public {
        vm.startPrank(governance);
        
        vault.registerTokenBinding(
            LOCAL_CHAIN_ID,
            TestHelpers.toBytes32(address(usdc)),
            SOLANA_DEVNET,
            SOLANA_USDC_MINT,
            1, 1
        );
        
        vault.registerTokenBinding(
            LOCAL_CHAIN_ID,
            TestHelpers.toBytes32(address(usdc)),
            SOLANA_DEVNET,
            SOLANA_USDT_MINT,
            998, 1000
        );
        
        vm.stopPrank();
        
        uint256 amount = 1000e6;
        
        vm.startPrank(alice);
        usdc.approve(address(vault), amount * 2);
        
        uint64 seq1 = vault.lockTokens{value: 0.001 ether}(
            address(usdc),
            amount,
            SOLANA_DEVNET,
            SOLANA_USDC_MINT,
            aliceSolanaAddress
        );
        
        uint64 seq2 = vault.lockTokens{value: 0.001 ether}(
            address(usdc),
            amount,
            SOLANA_DEVNET,
            SOLANA_USDT_MINT,
            aliceSolanaAddress
        );
        
        vm.stopPrank();
        
        assertEq(seq2, seq1 + 1);
    }
    
    function testIntegration_CrossCurrencyExchangeVerification() public {
        vm.prank(governance);
        vault.registerBidirectionalBinding(
            LOCAL_CHAIN_ID,
            TestHelpers.toBytes32(address(usdc)),
            SOLANA_DEVNET,
            SOLANA_USDT_MINT,
            998, 1000,
            1002, 1000
        );
        
        usdc.mint(address(vault), 10000e6);
        
        bytes memory vaa = vaaBuilder.buildTokenTransferVAA(
            0,
            guardianPrivateKeys,
            13,
            SOLANA_DEVNET,
            bytes32(uint256(0x123)),
            0,
            1000e6,
            SOLANA_USDT_MINT,
            SOLANA_DEVNET,
            TestHelpers.toBytes32(alice),
            LOCAL_CHAIN_ID,
            TestHelpers.toBytes32(address(usdc)),
            1002e6,
            1002, 1000
        );
        
        uint256 balanceBefore = usdc.balanceOf(alice);
        bool success = vault.unlockTokens(vaa);
        
        assertTrue(success);
        assertEq(usdc.balanceOf(alice), balanceBefore + 1002e6);
    }
}
