// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./TestSetup.sol";

interface IBridgeCore {
    function initialize(
        uint32 guardianSetIndex,
        address[] memory guardianAddresses,
        uint256 messageFee
    ) external;
    
    function publishMessage(
        uint32 nonce,
        bytes memory payload,
        uint8 consistencyLevel
    ) external payable returns (uint64 sequence);
    
    function receiveMessage(bytes memory vaa) external returns (bytes32 vaaHash);
    
    function getCurrentGuardianSetIndex() external view returns (uint32);
    
    function isVAAConsumed(bytes32 vaaHash) external view returns (bool);
    
    function getMessageSequence(address emitter) external view returns (uint64);
    
    function messageFee() external view returns (uint256);
    
    function paused() external view returns (bool);
    
    function setPaused(bool _paused) external;
    
    function updateGuardianSet(bytes memory vaa) external;
    
    event LogMessagePublished(
        address indexed sender,
        uint64 sequence,
        uint32 nonce,
        bytes payload,
        uint8 consistencyLevel
    );
    
    event MessageReceived(
        bytes32 indexed vaaHash,
        uint16 sourceChain,
        uint64 sequence
    );
    
    event GuardianSetUpdated(
        uint32 indexed oldIndex,
        uint32 indexed newIndex
    );
    
    event BridgePaused(address indexed by, uint256 timestamp);
    event BridgeUnpaused(address indexed by, uint256 timestamp);
}

contract BridgeCoreTest is TestSetup {
    IBridgeCore public bridgeCore;
    
    function setUp() public override {
        super.setUp();
    }
    
    function testPublishMessage() public {
        bytes memory payload = hex"010203";
        uint256 fee = bridgeCore.messageFee();
        
        vm.expectEmit(true, true, true, true);
        emit IBridgeCore.LogMessagePublished(
            address(this),
            0,
            123,
            payload,
            200
        );
        
        uint64 seq = bridgeCore.publishMessage{value: fee}(
            123,
            payload,
            200
        );
        
        assertEq(seq, 0);
    }
    
    function testPublishMessage_InsufficientFee() public {
        bytes memory payload = hex"010203";
        
        vm.expectRevert();
        bridgeCore.publishMessage{value: 0}(123, payload, 200);
    }
    
    function testPublishMessage_SequenceIncrement() public {
        bytes memory payload = hex"010203";
        uint256 fee = bridgeCore.messageFee();
        
        uint64 seq1 = bridgeCore.publishMessage{value: fee}(123, payload, 200);
        uint64 seq2 = bridgeCore.publishMessage{value: fee}(124, payload, 200);
        uint64 seq3 = bridgeCore.publishMessage{value: fee}(125, payload, 200);
        
        assertEq(seq1, 0);
        assertEq(seq2, 1);
        assertEq(seq3, 2);
    }
    
    function testPublishMessage_WhenPaused() public {
        vm.prank(governance);
        bridgeCore.setPaused(true);
        
        bytes memory payload = hex"010203";
        uint256 fee = bridgeCore.messageFee();
        
        vm.expectRevert();
        bridgeCore.publishMessage{value: fee}(123, payload, 200);
    }
    
    function testPublishMessage_EmptyPayload() public {
        bytes memory payload = "";
        uint256 fee = bridgeCore.messageFee();
        
        uint64 seq = bridgeCore.publishMessage{value: fee}(123, payload, 200);
        assertEq(seq, 0);
    }
    
    function testPublishMessage_LargePayload() public {
        bytes memory payload = new bytes(32768);
        uint256 fee = bridgeCore.messageFee();
        
        uint64 seq = bridgeCore.publishMessage{value: fee}(123, payload, 200);
        assertEq(seq, 0);
    }
    
    function testPublishMessage_DifferentConsistencyLevels() public {
        bytes memory payload = hex"010203";
        uint256 fee = bridgeCore.messageFee();
        
        uint64 seq1 = bridgeCore.publishMessage{value: fee}(123, payload, 1);
        uint64 seq2 = bridgeCore.publishMessage{value: fee}(124, payload, 15);
        uint64 seq3 = bridgeCore.publishMessage{value: fee}(125, payload, 200);
        
        assertEq(seq1, 0);
        assertEq(seq2, 1);
        assertEq(seq3, 2);
    }
    
    function testReceiveMessage_ValidVAA() public {
        bytes memory payload = TestHelpers.encodeTokenTransferPayload(
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
        
        bytes memory vaa = vaaBuilder.buildTokenTransferVAA(
            0,
            guardianPrivateKeys,
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
        
        bytes32 vaaHash = bridgeCore.receiveMessage(vaa);
        
        assertTrue(bridgeCore.isVAAConsumed(vaaHash));
    }
    
    function testReceiveMessage_InvalidVAA() public {
        bytes memory invalidVAA = hex"invalid";
        
        vm.expectRevert();
        bridgeCore.receiveMessage(invalidVAA);
    }
    
    function testReceiveMessage_InsufficientSignatures() public {
        bytes memory payload = TestHelpers.encodeTokenTransferPayload(
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
        
        bytes memory vaa = vaaBuilder.buildTokenTransferVAA(
            0,
            guardianPrivateKeys,
            12,
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
        
        vm.expectRevert();
        bridgeCore.receiveMessage(vaa);
    }
    
    function testReceiveMessage_ExactQuorum() public {
        bytes memory payload = TestHelpers.encodeTokenTransferPayload(
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
        
        bytes memory vaa = vaaBuilder.buildTokenTransferVAA(
            0,
            guardianPrivateKeys,
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
        
        bytes32 vaaHash = bridgeCore.receiveMessage(vaa);
        assertTrue(bridgeCore.isVAAConsumed(vaaHash));
    }
    
    function testReceiveMessage_AboveQuorum() public {
        bytes memory payload = TestHelpers.encodeTokenTransferPayload(
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
        
        bytes memory vaa = vaaBuilder.buildTokenTransferVAA(
            0,
            guardianPrivateKeys,
            15,
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
        
        bytes32 vaaHash = bridgeCore.receiveMessage(vaa);
        assertTrue(bridgeCore.isVAAConsumed(vaaHash));
    }
    
    function testReceiveMessage_InvalidSignature() public {
        uint256[] memory wrongKeys = new uint256[](19);
        for (uint8 i = 0; i < 19; i++) {
            wrongKeys[i] = uint256(keccak256(abi.encodePacked("wrong_guardian", i)));
        }
        
        bytes memory vaa = vaaBuilder.buildTokenTransferVAA(
            0,
            wrongKeys,
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
        
        vm.expectRevert();
        bridgeCore.receiveMessage(vaa);
    }
    
    function testReceiveMessage_InvalidGuardianSet() public {
        bytes memory vaa = vaaBuilder.buildTokenTransferVAA(
            999,
            guardianPrivateKeys,
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
        
        vm.expectRevert();
        bridgeCore.receiveMessage(vaa);
    }
    
    function testReceiveMessage_ExpiredGuardianSet() public {
        vm.expectRevert();
        bridgeCore.receiveMessage(new bytes(0));
    }
    
    function testVAAReplay_FirstSubmission() public {
        bytes memory vaa = vaaBuilder.buildTokenTransferVAA(
            0,
            guardianPrivateKeys,
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
        
        bytes32 vaaHash = bridgeCore.receiveMessage(vaa);
        assertTrue(bridgeCore.isVAAConsumed(vaaHash));
    }
    
    function testVAAReplay_DuplicateSubmission() public {
        bytes memory vaa = vaaBuilder.buildTokenTransferVAA(
            0,
            guardianPrivateKeys,
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
        
        bridgeCore.receiveMessage(vaa);
        
        vm.expectRevert();
        bridgeCore.receiveMessage(vaa);
    }
    
    function testVAAReplay_QueryUnconsumed() public {
        bytes32 randomHash = keccak256("random");
        assertFalse(bridgeCore.isVAAConsumed(randomHash));
    }
    
    function testVAAReplay_QueryConsumed() public {
        bytes memory vaa = vaaBuilder.buildTokenTransferVAA(
            0,
            guardianPrivateKeys,
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
        
        bytes32 vaaHash = bridgeCore.receiveMessage(vaa);
        assertTrue(bridgeCore.isVAAConsumed(vaaHash));
    }
    
    function testUpdateGuardianSet() public {
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
        
        vm.expectEmit(true, true, false, false);
        emit IBridgeCore.GuardianSetUpdated(0, 1);
        
        bridgeCore.updateGuardianSet(vaa);
        
        assertEq(bridgeCore.getCurrentGuardianSetIndex(), 1);
    }
    
    function testGetCurrentGuardianSetIndex() public {
        uint32 index = bridgeCore.getCurrentGuardianSetIndex();
        assertEq(index, 0);
    }
    
    function testGuardianSet_TransitionPeriod_OldSet() public {
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
        
        bytes memory oldSetVAA = vaaBuilder.buildTokenTransferVAA(
            0,
            guardianPrivateKeys,
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
        
        bytes32 vaaHash = bridgeCore.receiveMessage(oldSetVAA);
        assertTrue(bridgeCore.isVAAConsumed(vaaHash));
    }
    
    function testGuardianSet_TransitionPeriod_NewSet() public {
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
    
    function testGuardianSet_AfterExpiration() public {
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
        
        vm.warp(block.timestamp + 8 days);
        
        bytes memory oldSetVAA = vaaBuilder.buildTokenTransferVAA(
            0,
            guardianPrivateKeys,
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
        
        vm.expectRevert();
        bridgeCore.receiveMessage(oldSetVAA);
    }
    
    function testGuardianSet_UnauthorizedUpgrade() public {
        uint256[] memory wrongKeys = new uint256[](19);
        for (uint8 i = 0; i < 19; i++) {
            wrongKeys[i] = uint256(keccak256(abi.encodePacked("wrong", i)));
        }
        
        (address[] memory newGuardians,) = TestHelpers.generateGuardianKeys(19);
        
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
        
        bytes memory vaa = vaaBuilder.buildVAA(config, wrongKeys, 13);
        
        vm.expectRevert();
        bridgeCore.updateGuardianSet(vaa);
    }
}
