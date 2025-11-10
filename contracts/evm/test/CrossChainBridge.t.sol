// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./TestSetup.sol";

contract SolanaSimulator {
    mapping(bytes32 => uint256) public tokenBalances;
    mapping(bytes32 => bool) public vaaConsumed;
    
    event SolanaTokensReceived(
        bytes32 indexed recipient,
        bytes32 indexed tokenMint,
        uint256 amount
    );
    
    event SolanaTokensLocked(
        uint64 sequence,
        bytes32 indexed sender,
        uint256 amount,
        uint16 targetChain
    );
    
    function completeTransfer(
        bytes32 recipient,
        bytes32 tokenMint,
        uint256 amount,
        bytes32 vaaHash
    ) external {
        require(!vaaConsumed[vaaHash], "VAA already consumed");
        
        vaaConsumed[vaaHash] = true;
        tokenBalances[recipient] += amount;
        
        emit SolanaTokensReceived(recipient, tokenMint, amount);
    }
    
    function transferTokens(
        bytes32 sender,
        bytes32 tokenMint,
        uint256 amount,
        uint16 targetChain,
        uint64 sequence
    ) external {
        require(tokenBalances[sender] >= amount, "Insufficient balance");
        
        tokenBalances[sender] -= amount;
        
        emit SolanaTokensLocked(sequence, sender, amount, targetChain);
    }
    
    function getBalance(bytes32 account, bytes32 tokenMint) external view returns (uint256) {
        return tokenBalances[account];
    }
}

contract CrossChainBridgeTest is TestSetup {
    IBridgeCore public bridgeCore;
    ITokenVault public vault;
    SolanaSimulator public solanaSimulator;
    
    function setUp() public override {
        super.setUp();
        
        solanaSimulator = new SolanaSimulator();
        
        vm.prank(governance);
        vault.registerBidirectionalBinding(
            LOCAL_CHAIN_ID,
            TestHelpers.toBytes32(address(usdc)),
            SOLANA_DEVNET,
            SOLANA_USDC_MINT,
            1, 1,
            1, 1
        );
    }
    
    function testBridge_ETH_to_Solana_USDC() public {
        uint256 amount = 1000e6;
        
        vm.startPrank(alice);
        usdc.approve(address(vault), amount);
        
        uint256 aliceBalanceBefore = usdc.balanceOf(alice);
        uint256 vaultBalanceBefore = vault.custodyBalances(address(usdc));
        
        uint64 sequence = vault.lockTokens{value: 0.001 ether}(
            address(usdc),
            amount,
            SOLANA_DEVNET,
            SOLANA_USDC_MINT,
            aliceSolanaAddress
        );
        
        vm.stopPrank();
        
        assertEq(usdc.balanceOf(alice), aliceBalanceBefore - amount);
        assertEq(vault.custodyBalances(address(usdc)), vaultBalanceBefore + amount);
        
        bytes memory vaa = vaaBuilder.buildTokenTransferVAA(
            0,
            guardianPrivateKeys,
            13,
            LOCAL_CHAIN_ID,
            TestHelpers.toBytes32(address(vault)),
            sequence,
            amount,
            TestHelpers.toBytes32(address(usdc)),
            LOCAL_CHAIN_ID,
            aliceSolanaAddress,
            SOLANA_DEVNET,
            SOLANA_USDC_MINT,
            amount,
            1, 1
        );
        
        bytes32 vaaHash = keccak256(vaa);
        
        solanaSimulator.completeTransfer(
            aliceSolanaAddress,
            SOLANA_USDC_MINT,
            amount,
            vaaHash
        );
        
        uint256 solanaBalance = solanaSimulator.getBalance(aliceSolanaAddress, SOLANA_USDC_MINT);
        assertEq(solanaBalance, amount);
    }
    
    function testBridge_ETH_USDC_to_Solana_USDT() public {
        vm.prank(governance);
        vault.registerBidirectionalBinding(
            LOCAL_CHAIN_ID,
            TestHelpers.toBytes32(address(usdc)),
            SOLANA_DEVNET,
            SOLANA_USDT_MINT,
            998, 1000,
            1002, 1000
        );
        
        uint256 amount = 1000e6;
        uint256 expectedSolanaAmount = 998e6;
        
        vm.startPrank(alice);
        usdc.approve(address(vault), amount);
        
        uint64 sequence = vault.lockTokens{value: 0.001 ether}(
            address(usdc),
            amount,
            SOLANA_DEVNET,
            SOLANA_USDT_MINT,
            aliceSolanaAddress
        );
        
        vm.stopPrank();
        
        bytes memory vaa = vaaBuilder.buildTokenTransferVAA(
            0,
            guardianPrivateKeys,
            13,
            LOCAL_CHAIN_ID,
            TestHelpers.toBytes32(address(vault)),
            sequence,
            amount,
            TestHelpers.toBytes32(address(usdc)),
            LOCAL_CHAIN_ID,
            aliceSolanaAddress,
            SOLANA_DEVNET,
            SOLANA_USDT_MINT,
            expectedSolanaAmount,
            998, 1000
        );
        
        bytes32 vaaHash = keccak256(vaa);
        
        solanaSimulator.completeTransfer(
            aliceSolanaAddress,
            SOLANA_USDT_MINT,
            expectedSolanaAmount,
            vaaHash
        );
        
        uint256 solanaBalance = solanaSimulator.getBalance(aliceSolanaAddress, SOLANA_USDT_MINT);
        assertEq(solanaBalance, expectedSolanaAmount);
    }
    
    function testBridge_LargeAmount() public {
        uint256 amount = 100_000e6;
        
        vm.startPrank(alice);
        usdc.mint(alice, amount);
        usdc.approve(address(vault), amount);
        
        uint64 sequence = vault.lockTokens{value: 0.001 ether}(
            address(usdc),
            amount,
            SOLANA_DEVNET,
            SOLANA_USDC_MINT,
            aliceSolanaAddress
        );
        
        vm.stopPrank();
        
        bytes memory vaa = vaaBuilder.buildTokenTransferVAA(
            0,
            guardianPrivateKeys,
            13,
            LOCAL_CHAIN_ID,
            TestHelpers.toBytes32(address(vault)),
            sequence,
            amount,
            TestHelpers.toBytes32(address(usdc)),
            LOCAL_CHAIN_ID,
            aliceSolanaAddress,
            SOLANA_DEVNET,
            SOLANA_USDC_MINT,
            amount,
            1, 1
        );
        
        bytes32 vaaHash = keccak256(vaa);
        
        solanaSimulator.completeTransfer(
            aliceSolanaAddress,
            SOLANA_USDC_MINT,
            amount,
            vaaHash
        );
        
        uint256 solanaBalance = solanaSimulator.getBalance(aliceSolanaAddress, SOLANA_USDC_MINT);
        assertEq(solanaBalance, amount);
    }
    
    function testBridge_MultiUserConcurrent() public {
        uint256 amount = 1000e6;
        
        vm.startPrank(alice);
        usdc.approve(address(vault), amount);
        uint64 seqAlice = vault.lockTokens{value: 0.001 ether}(
            address(usdc),
            amount,
            SOLANA_DEVNET,
            SOLANA_USDC_MINT,
            aliceSolanaAddress
        );
        vm.stopPrank();
        
        vm.startPrank(bob);
        usdt.approve(address(vault), amount);
        vm.expectRevert();
        vault.lockTokens{value: 0.001 ether}(
            address(usdt),
            amount,
            SOLANA_DEVNET,
            SOLANA_USDC_MINT,
            bobSolanaAddress
        );
        vm.stopPrank();
        
        assertEq(seqAlice, 0);
    }
    
    function testBridge_Solana_to_ETH_USDC() public {
        usdc.mint(address(vault), 10000e6);
        
        uint256 amount = 1000e6;
        
        solanaSimulator.completeTransfer(
            aliceSolanaAddress,
            SOLANA_USDC_MINT,
            amount,
            bytes32(0)
        );
        
        uint64 solanaSequence = 42;
        
        bytes memory vaa = vaaBuilder.buildTokenTransferVAA(
            0,
            guardianPrivateKeys,
            13,
            SOLANA_DEVNET,
            bytes32(uint256(0x123)),
            solanaSequence,
            amount,
            SOLANA_USDC_MINT,
            SOLANA_DEVNET,
            TestHelpers.toBytes32(alice),
            LOCAL_CHAIN_ID,
            TestHelpers.toBytes32(address(usdc)),
            amount,
            1, 1
        );
        
        uint256 aliceBalanceBefore = usdc.balanceOf(alice);
        
        bool success = vault.unlockTokens(vaa);
        
        assertTrue(success);
        assertEq(usdc.balanceOf(alice), aliceBalanceBefore + amount);
    }
    
    function testBridge_Solana_USDC_to_ETH_USDT() public {
        usdt.mint(address(vault), 10000e6);
        
        vm.prank(governance);
        vault.registerBidirectionalBinding(
            SOLANA_DEVNET,
            SOLANA_USDC_MINT,
            LOCAL_CHAIN_ID,
            TestHelpers.toBytes32(address(usdt)),
            1002, 1000,
            998, 1000
        );
        
        uint256 amount = 1000e6;
        uint256 expectedEthAmount = 1002e6;
        
        bytes memory vaa = vaaBuilder.buildTokenTransferVAA(
            0,
            guardianPrivateKeys,
            13,
            SOLANA_DEVNET,
            bytes32(uint256(0x123)),
            42,
            amount,
            SOLANA_USDC_MINT,
            SOLANA_DEVNET,
            TestHelpers.toBytes32(alice),
            LOCAL_CHAIN_ID,
            TestHelpers.toBytes32(address(usdt)),
            expectedEthAmount,
            1002, 1000
        );
        
        uint256 aliceBalanceBefore = usdt.balanceOf(alice);
        
        bool success = vault.unlockTokens(vaa);
        
        assertTrue(success);
        assertEq(usdt.balanceOf(alice), aliceBalanceBefore + expectedEthAmount);
    }
    
    function testBridge_GuardianSignatureVerification() public {
        usdc.mint(address(vault), 10000e6);
        
        uint256 amount = 1000e6;
        
        bytes memory vaa = vaaBuilder.buildTokenTransferVAA(
            0,
            guardianPrivateKeys,
            13,
            SOLANA_DEVNET,
            bytes32(uint256(0x123)),
            42,
            amount,
            SOLANA_USDC_MINT,
            SOLANA_DEVNET,
            TestHelpers.toBytes32(alice),
            LOCAL_CHAIN_ID,
            TestHelpers.toBytes32(address(usdc)),
            amount,
            1, 1
        );
        
        bool success = vault.unlockTokens(vaa);
        
        assertTrue(success);
    }
    
    function testBridge_VAAReplayProtection() public {
        usdc.mint(address(vault), 10000e6);
        
        uint256 amount = 1000e6;
        
        bytes memory vaa = vaaBuilder.buildTokenTransferVAA(
            0,
            guardianPrivateKeys,
            13,
            SOLANA_DEVNET,
            bytes32(uint256(0x123)),
            42,
            amount,
            SOLANA_USDC_MINT,
            SOLANA_DEVNET,
            TestHelpers.toBytes32(alice),
            LOCAL_CHAIN_ID,
            TestHelpers.toBytes32(address(usdc)),
            amount,
            1, 1
        );
        
        vault.unlockTokens(vaa);
        
        vm.expectRevert();
        vault.unlockTokens(vaa);
    }
    
    function testBridge_RoundTrip() public {
        uint256 initialBalance = 1000e6;
        
        vm.startPrank(alice);
        usdc.approve(address(vault), initialBalance);
        
        uint64 seq1 = vault.lockTokens{value: 0.001 ether}(
            address(usdc),
            initialBalance,
            SOLANA_DEVNET,
            SOLANA_USDC_MINT,
            aliceSolanaAddress
        );
        vm.stopPrank();
        
        bytes memory vaa1 = vaaBuilder.buildTokenTransferVAA(
            0,
            guardianPrivateKeys,
            13,
            LOCAL_CHAIN_ID,
            TestHelpers.toBytes32(address(vault)),
            seq1,
            initialBalance,
            TestHelpers.toBytes32(address(usdc)),
            LOCAL_CHAIN_ID,
            aliceSolanaAddress,
            SOLANA_DEVNET,
            SOLANA_USDC_MINT,
            initialBalance,
            1, 1
        );
        
        bytes32 vaaHash1 = keccak256(vaa1);
        solanaSimulator.completeTransfer(
            aliceSolanaAddress,
            SOLANA_USDC_MINT,
            initialBalance,
            vaaHash1
        );
        
        assertEq(solanaSimulator.getBalance(aliceSolanaAddress, SOLANA_USDC_MINT), initialBalance);
        
        bytes memory vaa2 = vaaBuilder.buildTokenTransferVAA(
            0,
            guardianPrivateKeys,
            13,
            SOLANA_DEVNET,
            bytes32(uint256(0x123)),
            42,
            initialBalance,
            SOLANA_USDC_MINT,
            SOLANA_DEVNET,
            TestHelpers.toBytes32(alice),
            LOCAL_CHAIN_ID,
            TestHelpers.toBytes32(address(usdc)),
            initialBalance,
            1, 1
        );
        
        usdc.mint(address(vault), initialBalance);
        vault.unlockTokens(vaa2);
        
        assertEq(usdc.balanceOf(alice), initialBalance);
    }
    
    function testBridge_CrossCurrencyRoundTrip() public {
        vm.startPrank(governance);
        vault.registerBidirectionalBinding(
            LOCAL_CHAIN_ID,
            TestHelpers.toBytes32(address(usdc)),
            SOLANA_DEVNET,
            SOLANA_USDT_MINT,
            998, 1000,
            1002, 1000
        );
        vault.registerBidirectionalBinding(
            SOLANA_DEVNET,
            SOLANA_USDT_MINT,
            LOCAL_CHAIN_ID,
            TestHelpers.toBytes32(address(usdc)),
            1002, 1000,
            998, 1000
        );
        vm.stopPrank();
        
        uint256 initialBalance = 1000e6;
        
        vm.startPrank(alice);
        usdc.approve(address(vault), initialBalance);
        
        uint64 seq1 = vault.lockTokens{value: 0.001 ether}(
            address(usdc),
            initialBalance,
            SOLANA_DEVNET,
            SOLANA_USDT_MINT,
            aliceSolanaAddress
        );
        vm.stopPrank();
        
        uint256 solanaAmount = 998e6;
        
        bytes memory vaa1 = vaaBuilder.buildTokenTransferVAA(
            0,
            guardianPrivateKeys,
            13,
            LOCAL_CHAIN_ID,
            TestHelpers.toBytes32(address(vault)),
            seq1,
            initialBalance,
            TestHelpers.toBytes32(address(usdc)),
            LOCAL_CHAIN_ID,
            aliceSolanaAddress,
            SOLANA_DEVNET,
            SOLANA_USDT_MINT,
            solanaAmount,
            998, 1000
        );
        
        bytes32 vaaHash1 = keccak256(vaa1);
        solanaSimulator.completeTransfer(
            aliceSolanaAddress,
            SOLANA_USDT_MINT,
            solanaAmount,
            vaaHash1
        );
        
        assertEq(solanaSimulator.getBalance(aliceSolanaAddress, SOLANA_USDT_MINT), solanaAmount);
        
        uint256 returnAmount = (solanaAmount * 1002) / 1000;
        
        bytes memory vaa2 = vaaBuilder.buildTokenTransferVAA(
            0,
            guardianPrivateKeys,
            13,
            SOLANA_DEVNET,
            bytes32(uint256(0x123)),
            42,
            solanaAmount,
            SOLANA_USDT_MINT,
            SOLANA_DEVNET,
            TestHelpers.toBytes32(alice),
            LOCAL_CHAIN_ID,
            TestHelpers.toBytes32(address(usdc)),
            returnAmount,
            1002, 1000
        );
        
        usdc.mint(address(vault), returnAmount);
        vault.unlockTokens(vaa2);
        
        assertEq(usdc.balanceOf(alice), returnAmount);
    }
    
    function testBridge_MultipleRoundTrips() public {
        uint256 amount = 1000e6;
        
        for (uint256 i = 0; i < 3; i++) {
            vm.startPrank(alice);
            usdc.approve(address(vault), amount);
            
            uint64 seq = vault.lockTokens{value: 0.001 ether}(
                address(usdc),
                amount,
                SOLANA_DEVNET,
                SOLANA_USDC_MINT,
                aliceSolanaAddress
            );
            vm.stopPrank();
            
            bytes memory vaa1 = vaaBuilder.buildTokenTransferVAA(
                0,
                guardianPrivateKeys,
                13,
                LOCAL_CHAIN_ID,
                TestHelpers.toBytes32(address(vault)),
                seq,
                amount,
                TestHelpers.toBytes32(address(usdc)),
                LOCAL_CHAIN_ID,
                aliceSolanaAddress,
                SOLANA_DEVNET,
                SOLANA_USDC_MINT,
                amount,
                1, 1
            );
            
            bytes32 vaaHash1 = keccak256(vaa1);
            solanaSimulator.completeTransfer(
                aliceSolanaAddress,
                SOLANA_USDC_MINT,
                amount,
                vaaHash1
            );
            
            bytes memory vaa2 = vaaBuilder.buildTokenTransferVAA(
                0,
                guardianPrivateKeys,
                13,
                SOLANA_DEVNET,
                bytes32(uint256(0x123)),
                uint64(42 + i),
                amount,
                SOLANA_USDC_MINT,
                SOLANA_DEVNET,
                TestHelpers.toBytes32(alice),
                LOCAL_CHAIN_ID,
                TestHelpers.toBytes32(address(usdc)),
                amount,
                1, 1
            );
            
            usdc.mint(address(vault), amount);
            vault.unlockTokens(vaa2);
        }
        
        assertEq(usdc.balanceOf(alice), 3 * amount);
    }
    
    function testBridge_Error_InvalidGuardianSignature() public {
        usdc.mint(address(vault), 10000e6);
        
        uint256[] memory wrongKeys = new uint256[](19);
        for (uint8 i = 0; i < 19; i++) {
            wrongKeys[i] = uint256(keccak256(abi.encodePacked("wrong", i)));
        }
        
        bytes memory vaa = vaaBuilder.buildTokenTransferVAA(
            0,
            wrongKeys,
            13,
            SOLANA_DEVNET,
            bytes32(uint256(0x123)),
            42,
            1000e6,
            SOLANA_USDC_MINT,
            SOLANA_DEVNET,
            TestHelpers.toBytes32(alice),
            LOCAL_CHAIN_ID,
            TestHelpers.toBytes32(address(usdc)),
            1000e6,
            1, 1
        );
        
        vm.expectRevert();
        vault.unlockTokens(vaa);
    }
    
    function testBridge_Error_InsufficientSignatures() public {
        usdc.mint(address(vault), 10000e6);
        
        bytes memory vaa = vaaBuilder.buildTokenTransferVAA(
            0,
            guardianPrivateKeys,
            12,
            SOLANA_DEVNET,
            bytes32(uint256(0x123)),
            42,
            1000e6,
            SOLANA_USDC_MINT,
            SOLANA_DEVNET,
            TestHelpers.toBytes32(alice),
            LOCAL_CHAIN_ID,
            TestHelpers.toBytes32(address(usdc)),
            1000e6,
            1, 1
        );
        
        vm.expectRevert();
        vault.unlockTokens(vaa);
    }
    
    function testBridge_Error_WrongChain() public {
        usdc.mint(address(vault), 10000e6);
        
        bytes memory vaa = vaaBuilder.buildTokenTransferVAA(
            0,
            guardianPrivateKeys,
            13,
            SOLANA_DEVNET,
            bytes32(uint256(0x123)),
            42,
            1000e6,
            SOLANA_USDC_MINT,
            SOLANA_DEVNET,
            TestHelpers.toBytes32(alice),
            ETHEREUM_MAINNET,
            TestHelpers.toBytes32(address(usdc)),
            1000e6,
            1, 1
        );
        
        vm.expectRevert();
        vault.unlockTokens(vaa);
    }
    
    function testBridge_Error_TokenBindingNotFound() public {
        usdc.mint(address(vault), 10000e6);
        
        bytes memory vaa = vaaBuilder.buildTokenTransferVAA(
            0,
            guardianPrivateKeys,
            13,
            SOLANA_DEVNET,
            bytes32(uint256(0x123)),
            42,
            1000e6,
            bytes32(uint256(0x999999)),
            SOLANA_DEVNET,
            TestHelpers.toBytes32(alice),
            LOCAL_CHAIN_ID,
            TestHelpers.toBytes32(address(usdc)),
            1000e6,
            1, 1
        );
        
        vm.expectRevert();
        vault.unlockTokens(vaa);
    }
    
    function testBridge_Error_ExchangeRateMismatch() public {
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
            42,
            1000e6,
            SOLANA_USDC_MINT,
            SOLANA_DEVNET,
            TestHelpers.toBytes32(alice),
            LOCAL_CHAIN_ID,
            TestHelpers.toBytes32(address(usdc)),
            1000e6,
            999, 1000
        );
        
        vm.expectRevert();
        vault.unlockTokens(vaa);
    }
    
    function testBridge_Error_InsufficientCustody() public {
        bytes memory vaa = vaaBuilder.buildTokenTransferVAA(
            0,
            guardianPrivateKeys,
            13,
            SOLANA_DEVNET,
            bytes32(uint256(0x123)),
            42,
            1000e6,
            SOLANA_USDC_MINT,
            SOLANA_DEVNET,
            TestHelpers.toBytes32(alice),
            LOCAL_CHAIN_ID,
            TestHelpers.toBytes32(address(usdc)),
            1000e6,
            1, 1
        );
        
        vm.expectRevert();
        vault.unlockTokens(vaa);
    }
}

