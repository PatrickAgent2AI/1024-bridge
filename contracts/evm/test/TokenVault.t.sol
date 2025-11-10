// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./TestSetup.sol";

interface ITokenVault {
    function initialize(address bridgeCore) external;
    
    function initializeCustody(address token) external;
    
    function lockTokens(
        address sourceToken,
        uint256 amount,
        uint16 targetChain,
        bytes32 targetToken,
        bytes32 recipient
    ) external payable returns (uint64 sequence);
    
    function unlockTokens(bytes memory vaa) external returns (bool success);
    
    function registerTokenBinding(
        uint16 sourceChain,
        bytes32 sourceToken,
        uint16 targetChain,
        bytes32 targetToken,
        uint64 exchangeRateNumerator,
        uint64 exchangeRateDenominator
    ) external;
    
    function registerBidirectionalBinding(
        uint16 localChain,
        bytes32 localToken,
        uint16 remoteChain,
        bytes32 remoteToken,
        uint64 outboundRateNum,
        uint64 outboundRateDenom,
        uint64 inboundRateNum,
        uint64 inboundRateDenom
    ) external;
    
    function setExchangeRate(
        uint16 sourceChain,
        bytes32 sourceToken,
        uint16 targetChain,
        bytes32 targetToken,
        uint64 newRateNumerator,
        uint64 newRateDenominator
    ) external;
    
    function setTokenBindingEnabled(
        uint16 sourceChain,
        bytes32 sourceToken,
        uint16 targetChain,
        bytes32 targetToken,
        bool enabled
    ) external;
    
    function updateAMMConfig(address ammAddress, bool enabled) external;
    
    function setRateLimit(uint256 maxPerTransaction, uint256 maxPerDay) external;
    
    function setPaused(bool _paused) external;
    
    function paused() external view returns (bool);
    
    function custodyBalances(address token) external view returns (uint256);
    
    event TokensLocked(
        bytes32 indexed transferId,
        address indexed sourceToken,
        address indexed sender,
        uint256 amount,
        uint16 targetChain,
        bytes32 targetToken,
        bytes32 recipient,
        uint256 targetAmount
    );
    
    event TokensUnlocked(
        bytes32 indexed transferId,
        address indexed targetToken,
        address indexed recipient,
        uint256 amount,
        uint16 sourceChain,
        bytes32 sourceToken
    );
    
    event TokenBindingRegistered(
        uint16 indexed sourceChain,
        bytes32 indexed sourceToken,
        uint16 indexed targetChain,
        bytes32 targetToken,
        uint64 exchangeRateNumerator,
        uint64 exchangeRateDenominator
    );
}

contract TokenVaultTest is TestSetup {
    ITokenVault public vault;
    IBridgeCore public bridgeCore;
    
    function setUp() public override {
        super.setUp();
    }
    
    function testLockTokens_Success() public {
        uint256 amount = 1000e6;
        
        vm.startPrank(alice);
        usdc.approve(address(vault), amount);
        
        uint256 userBalanceBefore = usdc.balanceOf(alice);
        uint256 vaultBalanceBefore = vault.custodyBalances(address(usdc));
        
        vm.expectEmit(true, true, true, true);
        emit ITokenVault.TokensLocked(
            bytes32(0),
            address(usdc),
            alice,
            amount,
            SOLANA_DEVNET,
            SOLANA_USDC_MINT,
            aliceSolanaAddress,
            amount
        );
        
        uint64 sequence = vault.lockTokens{value: 0.001 ether}(
            address(usdc),
            amount,
            SOLANA_DEVNET,
            SOLANA_USDC_MINT,
            aliceSolanaAddress
        );
        
        vm.stopPrank();
        
        assertEq(usdc.balanceOf(alice), userBalanceBefore - amount);
        assertEq(vault.custodyBalances(address(usdc)), vaultBalanceBefore + amount);
        assertEq(sequence, 0);
    }
    
    function testLockTokens_InsufficientAllowance() public {
        uint256 amount = 1000e6;
        
        vm.startPrank(alice);
        usdc.approve(address(vault), amount - 1);
        
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
    
    function testLockTokens_InsufficientBalance() public {
        uint256 amount = 100_000_000e6;
        
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
    
    function testLockTokens_ExceedsSingleLimit() public {
        uint256 amount = 2_000_000e6;
        
        vm.startPrank(alice);
        usdc.mint(alice, amount);
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
    
    function testLockTokens_ExceedsDailyLimit() public {
        uint256 amount = 100_000e6;
        
        vm.startPrank(alice);
        usdc.mint(alice, 10_000_000e6);
        usdc.approve(address(vault), 10_000_000e6);
        
        for (uint256 i = 0; i < 50; i++) {
            vault.lockTokens{value: 0.001 ether}(
                address(usdc),
                amount,
                SOLANA_DEVNET,
                SOLANA_USDC_MINT,
                aliceSolanaAddress
            );
        }
        
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
    
    function testLockTokens_InsufficientFee() public {
        uint256 amount = 1000e6;
        
        vm.startPrank(alice);
        usdc.approve(address(vault), amount);
        
        vm.expectRevert();
        vault.lockTokens{value: 0}(
            address(usdc),
            amount,
            SOLANA_DEVNET,
            SOLANA_USDC_MINT,
            aliceSolanaAddress
        );
        
        vm.stopPrank();
    }
    
    function testLockTokens_InvalidChainId() public {
        uint256 amount = 1000e6;
        
        vm.startPrank(alice);
        usdc.approve(address(vault), amount);
        
        vm.expectRevert();
        vault.lockTokens{value: 0.001 ether}(
            address(usdc),
            amount,
            LOCAL_CHAIN_ID,
            SOLANA_USDC_MINT,
            aliceSolanaAddress
        );
        
        vm.stopPrank();
    }
    
    function testLockTokens_WhenPaused() public {
        vm.prank(governance);
        vault.setPaused(true);
        
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
    
    function testLockTokens_ZeroAmount() public {
        uint256 amount = 0;
        
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
    
    function testLockTokens_MaxAmount() public {
        uint256 amount = 1_000_000e6;
        
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
        
        assertEq(sequence, 0);
    }
    
    function testUnlockTokens_Success() public {
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
        
        uint256 aliceBalanceBefore = usdc.balanceOf(alice);
        
        bool success = vault.unlockTokens(vaa);
        
        assertTrue(success);
        assertEq(usdc.balanceOf(alice), aliceBalanceBefore + 1000e6);
    }
    
    function testUnlockTokens_InvalidVAA() public {
        bytes memory invalidVAA = hex"deadbeef";
        
        vm.expectRevert();
        vault.unlockTokens(invalidVAA);
    }
    
    function testUnlockTokens_VAAAlreadyConsumed() public {
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
        
        vault.unlockTokens(vaa);
        
        vm.expectRevert();
        vault.unlockTokens(vaa);
    }
    
    function testUnlockTokens_InsufficientBalance() public {
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
        
        vm.expectRevert();
        vault.unlockTokens(vaa);
    }
    
    function testUnlockTokens_InvalidToken() public {
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
            bytes32(uint256(uint160(address(0xdead)))),
            1000e6,
            1,
            1
        );
        
        vm.expectRevert();
        vault.unlockTokens(vaa);
    }
    
    function testUnlockTokens_WhenPaused() public {
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
        
        vm.prank(governance);
        vault.setPaused(true);
        
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
        
        vm.expectRevert();
        vault.unlockTokens(vaa);
    }
    
    function testRateLimit_SingleLimitBoundary() public {
        uint256 amount = 1_000_000e6;
        
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
        
        assertEq(sequence, 0);
    }
    
    function testRateLimit_SingleLimitPlusOne() public {
        uint256 amount = 1_000_001e6;
        
        vm.startPrank(alice);
        usdc.mint(alice, amount);
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
    
    function testRateLimit_DailyLimitAccumulation() public {
        uint256 amount = 1_000_000e6;
        
        vm.startPrank(alice);
        usdc.mint(alice, 11_000_000e6);
        usdc.approve(address(vault), 11_000_000e6);
        
        for (uint256 i = 0; i < 10; i++) {
            vault.lockTokens{value: 0.001 ether}(
                address(usdc),
                amount,
                SOLANA_DEVNET,
                SOLANA_USDC_MINT,
                aliceSolanaAddress
            );
        }
        
        vm.stopPrank();
    }
    
    function testRateLimit_ExceedsDailyLimit() public {
        uint256 amount = 1_000_000e6;
        
        vm.startPrank(alice);
        usdc.mint(alice, 11_000_000e6);
        usdc.approve(address(vault), 11_000_000e6);
        
        for (uint256 i = 0; i < 10; i++) {
            vault.lockTokens{value: 0.001 ether}(
                address(usdc),
                amount,
                SOLANA_DEVNET,
                SOLANA_USDC_MINT,
                aliceSolanaAddress
            );
        }
        
        vm.expectRevert();
        vault.lockTokens{value: 0.001 ether}(
            address(usdc),
            1e6,
            SOLANA_DEVNET,
            SOLANA_USDC_MINT,
            aliceSolanaAddress
        );
        
        vm.stopPrank();
    }
    
    function testRateLimit_Reset24Hours() public {
        uint256 amount = 1_000_000e6;
        
        vm.startPrank(alice);
        usdc.mint(alice, 11_000_000e6);
        usdc.approve(address(vault), 11_000_000e6);
        
        for (uint256 i = 0; i < 10; i++) {
            vault.lockTokens{value: 0.001 ether}(
                address(usdc),
                amount,
                SOLANA_DEVNET,
                SOLANA_USDC_MINT,
                aliceSolanaAddress
            );
        }
        
        vm.warp(block.timestamp + 25 hours);
        
        uint64 sequence = vault.lockTokens{value: 0.001 ether}(
            address(usdc),
            amount,
            SOLANA_DEVNET,
            SOLANA_USDC_MINT,
            aliceSolanaAddress
        );
        
        vm.stopPrank();
        
        assertGt(sequence, 0);
    }
    
    function testRateLimit_UpdateLimits() public {
        vm.prank(governance);
        vault.setRateLimit(500_000e6, 5_000_000e6);
        
        uint256 amount = 500_000e6;
        
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
        
        assertEq(sequence, 0);
    }
    
    function testAdmin_PauseContract() public {
        vm.prank(governance);
        vault.setPaused(true);
        
        assertTrue(vault.paused());
    }
    
    function testAdmin_PauseUnauthorized() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.setPaused(true);
    }
    
    function testAdmin_UnpauseContract() public {
        vm.prank(governance);
        vault.setPaused(true);
        
        vm.prank(governance);
        vault.setPaused(false);
        
        assertFalse(vault.paused());
    }
    
    function testAdmin_SetRateLimit() public {
        vm.prank(governance);
        vault.setRateLimit(2_000_000e6, 20_000_000e6);
    }
    
    function testAdmin_SetRateLimitUnauthorized() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.setRateLimit(2_000_000e6, 20_000_000e6);
    }
    
    function testAdmin_WithdrawFees() public {
        vm.deal(address(vault), 10 ether);
        
        uint256 governanceBalanceBefore = governance.balance;
        
        vm.prank(governance);
        vm.expectRevert();
    }
    
    function testAdmin_WithdrawFeesUnauthorized() public {
        vm.deal(address(vault), 10 ether);
        
        vm.prank(alice);
        vm.expectRevert();
    }
    
    function testAdmin_WithdrawFeesExceedsBalance() public {
        vm.deal(address(vault), 1 ether);
        
        vm.prank(governance);
        vm.expectRevert();
    }
}
