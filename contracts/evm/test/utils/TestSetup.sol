// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../mocks/MockERC20.sol";
import "./VAABuilder.sol";

abstract contract TestSetup is Test {
    using VAABuilder for *;
    
    address public governance = address(0x1);
    address public user = address(0x2);
    address public user2 = address(0x3);
    address public relayer = address(0x4);
    
    address[] public guardians;
    uint256[] public guardianPrivateKeys;
    
    MockERC20 public usdc;
    MockERC20 public usdt;
    MockERC20 public weth;
    
    uint256 public constant MESSAGE_FEE = 0.001 ether;
    uint256 public constant MAX_SINGLE_TRANSFER = 1_000_000 * 10**6;
    uint256 public constant MAX_DAILY_TRANSFER = 10_000_000 * 10**6;
    
    uint8 public constant GUARDIAN_QUORUM = 13;
    uint8 public constant TOTAL_GUARDIANS = 19;
    
    function setUp() public virtual {
        vm.deal(user, 100 ether);
        vm.deal(user2, 100 ether);
        vm.deal(relayer, 100 ether);
        vm.deal(governance, 100 ether);
        
        initializeGuardians();
        
        usdc = new MockERC20("USD Coin", "USDC", 6);
        usdt = new MockERC20("Tether USD", "USDT", 6);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        
        usdc.mint(user, 10_000_000 * 10**6);
        usdt.mint(user, 10_000_000 * 10**6);
        weth.mint(user, 1000 * 10**18);
        
        usdc.mint(user2, 10_000_000 * 10**6);
    }
    
    function initializeGuardians() internal {
        for (uint i = 1; i <= TOTAL_GUARDIANS; i++) {
            uint256 privateKey = i;
            address guardianAddress = vm.addr(privateKey);
            
            guardianPrivateKeys.push(privateKey);
            guardians.push(guardianAddress);
        }
    }
    
    function buildValidVAA(
        uint32 guardianSetIndex,
        uint8 numSignatures,
        bytes memory payload,
        uint32 nonce,
        uint16 emitterChain,
        address emitter,
        uint64 sequence
    ) internal view returns (bytes memory) {
        require(numSignatures <= TOTAL_GUARDIANS, "Too many signatures");
        
        bytes memory body = abi.encodePacked(
            uint32(block.timestamp),
            nonce,
            emitterChain,
            bytes32(uint256(uint160(emitter))),
            sequence,
            uint8(200)
        );
        
        bytes32 bodyHash = keccak256(abi.encodePacked(keccak256(body), payload));
        
        VAABuilder.Signature[] memory signatures = new VAABuilder.Signature[](numSignatures);
        
        for (uint8 i = 0; i < numSignatures; i++) {
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(guardianPrivateKeys[i], bodyHash);
            signatures[i] = VAABuilder.Signature({
                guardianIndex: i,
                r: r,
                s: s,
                v: v
            });
        }
        
        bytes memory vaaBody = abi.encodePacked(body, payload);
        
        return VAABuilder.buildVAA(
            1,
            guardianSetIndex,
            signatures,
            uint32(block.timestamp),
            nonce,
            emitterChain,
            bytes32(uint256(uint160(emitter))),
            sequence,
            200,
            payload
        );
    }
    
    function buildTokenTransferVAA(
        address sourceToken,
        uint256 amount,
        uint16 sourceChain,
        bytes32 recipient,
        uint16 targetChain,
        address targetToken,
        uint64 targetAmount,
        uint64 rateNum,
        uint64 rateDenom,
        address emitter,
        uint64 sequence
    ) internal view returns (bytes memory) {
        bytes memory payload = VAABuilder.buildTokenTransferPayload(
            amount,
            bytes32(uint256(uint160(sourceToken))),
            sourceChain,
            recipient,
            targetChain,
            bytes32(uint256(uint160(targetToken))),
            targetAmount,
            rateNum,
            rateDenom
        );
        
        return buildValidVAA(
            0,
            GUARDIAN_QUORUM,
            payload,
            uint32(block.timestamp),
            sourceChain,
            emitter,
            sequence
        );
    }
    
    function getGuardianAddresses() internal view returns (address[] memory) {
        return guardians;
    }
    
    function addressToBytes32(address addr) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(addr)));
    }
    
    function bytes32ToAddress(bytes32 b) internal pure returns (address) {
        return address(uint160(uint256(b)));
    }
}

