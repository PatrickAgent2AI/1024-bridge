// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "./mocks/MockERC20.sol";
import "./utils/TestHelpers.sol";

contract TestSetup is Test {
    address public governance = address(0x1);
    address public alice = address(0x2);
    address public bob = address(0x3);
    address public relayer = address(0x4);
    
    address[] public guardians;
    uint256[] public guardianPrivateKeys;
    
    MockERC20 public usdc;
    MockERC20 public usdt;
    MockERC20 public weth;
    
    bytes32 public aliceSolanaAddress;
    bytes32 public bobSolanaAddress;
    
    uint16 public constant LOCAL_CHAIN_ID = 65520;
    uint16 public constant SOLANA_DEVNET = 901;
    uint16 public constant ETHEREUM_MAINNET = 1;
    
    bytes32 public constant SOLANA_USDC_MINT = bytes32(uint256(0x123456789));
    bytes32 public constant SOLANA_USDT_MINT = bytes32(uint256(0x987654321));
    
    VAABuilder public vaaBuilder;
    
    function setUp() public virtual {
        vm.label(governance, "Governance");
        vm.label(alice, "Alice");
        vm.label(bob, "Bob");
        vm.label(relayer, "Relayer");
        
        (guardians, guardianPrivateKeys) = TestHelpers.generateGuardianKeys(19);
        
        for (uint8 i = 0; i < 19; i++) {
            vm.label(guardians[i], string.concat("Guardian", vm.toString(i)));
        }
        
        usdc = new MockERC20("USD Coin", "USDC", 6);
        usdt = new MockERC20("Tether USD", "USDT", 6);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        
        vm.label(address(usdc), "USDC");
        vm.label(address(usdt), "USDT");
        vm.label(address(weth), "WETH");
        
        aliceSolanaAddress = bytes32(uint256(0x111111));
        bobSolanaAddress = bytes32(uint256(0x222222));
        
        vaaBuilder = new VAABuilder();
        
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(relayer, 100 ether);
        
        usdc.mint(alice, 10_000_000e6);
        usdt.mint(bob, 5_000_000e6);
        weth.mint(alice, 1000e18);
    }
}

