// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./utils/TestSetup.sol";
import "../src/BridgeCore.sol";

contract BridgeCoreTest is TestSetup {
    BridgeCore public bridgeCore;
    
    function setUp() public override {
        super.setUp();
        
        bridgeCore = new BridgeCore();
        bridgeCore.initialize(getGuardianAddresses(), governance);
    }
    
    function testPublishMessage() public {
        bytes memory payload = hex"010203";
        uint256 fee = bridgeCore.messageFee();
        
        vm.deal(address(this), 1 ether);
        uint64 seq = bridgeCore.publishMessage{value: fee}(123, payload, 200);
        
        assertEq(seq, 0);
    }
    
    function testPublishMessage_InsufficientFee() public {
        bytes memory payload = hex"010203";
        
        vm.expectRevert(IBridgeCore.InsufficientFee.selector);
        bridgeCore.publishMessage{value: 0}(123, payload, 200);
    }
    
    function testPublishMessage_SequenceIncrement() public {
        bytes memory payload = hex"010203";
        uint256 fee = bridgeCore.messageFee();
        
        vm.deal(user, 1 ether);
        vm.startPrank(user);
        
        uint64 seq1 = bridgeCore.publishMessage{value: fee}(123, payload, 200);
        uint64 seq2 = bridgeCore.publishMessage{value: fee}(124, payload, 200);
        uint64 seq3 = bridgeCore.publishMessage{value: fee}(125, payload, 200);
        
        vm.stopPrank();
        
        assertEq(seq1, 0);
        assertEq(seq2, 1);
        assertEq(seq3, 2);
    }
    
    function testPublishMessage_WhenPaused() public {
        bytes memory payload = hex"010203";
        uint256 fee = bridgeCore.messageFee();
        
        vm.prank(governance);
        bridgeCore.setPaused(true);
        
        vm.expectRevert(IBridgeCore.BridgePaused.selector);
        bridgeCore.publishMessage{value: fee}(123, payload, 200);
    }
    
    function testPublishMessage_EmptyPayload() public {
        bytes memory payload = "";
        uint256 fee = bridgeCore.messageFee();
        
        vm.deal(address(this), 1 ether);
        uint64 seq = bridgeCore.publishMessage{value: fee}(123, payload, 200);
        
        assertEq(seq, 0);
    }
    
    function testPublishMessage_LargePayload() public {
        bytes memory payload = new bytes(32 * 1024);
        uint256 fee = bridgeCore.messageFee();
        
        vm.deal(address(this), 1 ether);
        uint64 seq = bridgeCore.publishMessage{value: fee}(123, payload, 200);
        
        assertEq(seq, 0);
    }
    
    function testPublishMessage_DifferentConsistencyLevel() public {
        bytes memory payload = hex"010203";
        uint256 fee = bridgeCore.messageFee();
        
        vm.deal(address(this), 1 ether);
        
        uint64 seq1 = bridgeCore.publishMessage{value: fee}(123, payload, 1);
        uint64 seq2 = bridgeCore.publishMessage{value: fee}(124, payload, 15);
        uint64 seq3 = bridgeCore.publishMessage{value: fee}(125, payload, 200);
        
        assertEq(seq1, 0);
        assertEq(seq2, 1);
        assertEq(seq3, 2);
    }
    
    function testReceiveMessage_ValidVAA() public {
        bytes memory payload = hex"0102030405";
        bytes memory vaa = buildValidVAA(0, GUARDIAN_QUORUM, payload, 123, 1, address(this), 0);
        
        bool success = bridgeCore.receiveMessage(vaa);
        
        assertTrue(success);
        bytes32 vaaHash = keccak256(vaa);
        assertTrue(bridgeCore.isVAAConsumed(vaaHash));
    }
    
    function testReceiveMessage_InvalidVAA() public {
        bytes memory invalidVAA = hex"0001";
        
        vm.expectRevert(IBridgeCore.InvalidVAA.selector);
        bridgeCore.receiveMessage(invalidVAA);
    }
    
    function testReceiveMessage_InsufficientSignatures() public {
        bytes memory payload = hex"0102030405";
        bytes memory vaa = buildValidVAA(0, 12, payload, 123, 1, address(this), 0);
        
        vm.expectRevert(IBridgeCore.InsufficientSignatures.selector);
        bridgeCore.receiveMessage(vaa);
    }
    
    function testReceiveMessage_ExactQuorum() public {
        bytes memory payload = hex"0102030405";
        bytes memory vaa = buildValidVAA(0, GUARDIAN_QUORUM, payload, 123, 1, address(this), 0);
        
        bool success = bridgeCore.receiveMessage(vaa);
        assertTrue(success);
    }
    
    function testReceiveMessage_AboveQuorum() public {
        bytes memory payload = hex"0102030405";
        bytes memory vaa = buildValidVAA(0, 15, payload, 123, 1, address(this), 0);
        
        bool success = bridgeCore.receiveMessage(vaa);
        assertTrue(success);
    }
    
    function testReceiveMessage_InvalidSignature() public {
        bytes memory payload = hex"0102030405";
        bytes memory vaa = buildValidVAA(0, GUARDIAN_QUORUM, payload, 123, 1, address(this), 0);
        
        vaa[10] = bytes1(uint8(vaa[10]) ^ 0xFF);
        
        vm.expectRevert();
        bridgeCore.receiveMessage(vaa);
    }
    
    function testReceiveMessage_InvalidGuardianSet() public {
        bytes memory payload = hex"0102030405";
        bytes memory vaa = buildValidVAA(99, GUARDIAN_QUORUM, payload, 123, 1, address(this), 0);
        
        vm.expectRevert(IBridgeCore.InvalidGuardianSet.selector);
        bridgeCore.receiveMessage(vaa);
    }
    
    function testReceiveMessage_ExpiredGuardianSet() public {
        bytes memory payload = hex"0102030405";
        bytes memory vaa = buildValidVAA(0, GUARDIAN_QUORUM, payload, 123, 1, address(this), 0);
        
        vm.warp(block.timestamp + 8 days);
        
        vm.expectRevert();
        bridgeCore.receiveMessage(vaa);
    }
    
    function testVAAReplayProtection_First() public {
        bytes memory payload = hex"0102030405";
        bytes memory vaa = buildValidVAA(0, GUARDIAN_QUORUM, payload, 123, 1, address(this), 0);
        
        bool success = bridgeCore.receiveMessage(vaa);
        assertTrue(success);
    }
    
    function testVAAReplayProtection_Duplicate() public {
        bytes memory payload = hex"0102030405";
        bytes memory vaa = buildValidVAA(0, GUARDIAN_QUORUM, payload, 123, 1, address(this), 0);
        
        bridgeCore.receiveMessage(vaa);
        
        vm.expectRevert(IBridgeCore.VAAAlreadyConsumed.selector);
        bridgeCore.receiveMessage(vaa);
    }
    
    function testIsVAAConsumed_Unconsumed() public {
        bytes memory payload = hex"0102030405";
        bytes memory vaa = buildValidVAA(0, GUARDIAN_QUORUM, payload, 123, 1, address(this), 0);
        
        bytes32 vaaHash = keccak256(vaa);
        assertFalse(bridgeCore.isVAAConsumed(vaaHash));
    }
    
    function testIsVAAConsumed_Consumed() public {
        bytes memory payload = hex"0102030405";
        bytes memory vaa = buildValidVAA(0, GUARDIAN_QUORUM, payload, 123, 1, address(this), 0);
        
        bridgeCore.receiveMessage(vaa);
        
        bytes32 vaaHash = keccak256(vaa);
        assertTrue(bridgeCore.isVAAConsumed(vaaHash));
    }
    
    function testUpdateGuardianSet() public {
        bytes memory payload = hex"0102030405";
        bytes memory vaa = buildValidVAA(0, GUARDIAN_QUORUM, payload, 123, 1, address(this), 0);
        
        vm.prank(governance);
        bridgeCore.updateGuardianSet(vaa);
    }
    
    function testGetCurrentGuardianSetIndex() public {
        uint32 index = bridgeCore.getCurrentGuardianSetIndex();
        assertEq(index, 0);
    }
    
    function testGuardianSet_TransitionPeriodOld() public {
        bytes memory payload = hex"0102030405";
        bytes memory vaa = buildValidVAA(0, GUARDIAN_QUORUM, payload, 123, 1, address(this), 0);
        
        bool success = bridgeCore.receiveMessage(vaa);
        assertTrue(success);
    }
    
    function testGuardianSet_TransitionPeriodNew() public {
        bytes memory payload = hex"0102030405";
        bytes memory vaa = buildValidVAA(0, GUARDIAN_QUORUM, payload, 123, 1, address(this), 0);
        
        bool success = bridgeCore.receiveMessage(vaa);
        assertTrue(success);
    }
    
    function testGuardianSet_AfterExpiration() public {
        bytes memory payload = hex"0102030405";
        bytes memory vaa = buildValidVAA(0, GUARDIAN_QUORUM, payload, 123, 1, address(this), 0);
        
        vm.warp(block.timestamp + 8 days);
        
        vm.expectRevert();
        bridgeCore.receiveMessage(vaa);
    }
    
    function testUpdateGuardianSet_Unauthorized() public {
        bytes memory payload = hex"0102030405";
        bytes memory vaa = buildValidVAA(0, GUARDIAN_QUORUM, payload, 123, 1, address(this), 0);
        
        vm.prank(user);
        vm.expectRevert(IBridgeCore.Unauthorized.selector);
        bridgeCore.updateGuardianSet(vaa);
    }
}

