function evmAddressToBytes32(address: string): Uint8Array {
  const cleanAddress = address.toLowerCase().replace('0x', '');
  const addressBytes = Buffer.from(cleanAddress, 'hex');
  
  const bytes32 = Buffer.alloc(32);
  addressBytes.copy(bytes32, 12);
  
  return new Uint8Array(bytes32);
}

function solanaAddressToBytes32(address: string): Uint8Array {
  const bs58 = require('bs58');
  const decoded = bs58.decode(address);
  
  if (decoded.length !== 32) {
    throw new Error('Invalid Solana address');
  }
  
  return new Uint8Array(decoded);
}

type ChainType = 'evm' | 'solana';

function getChainType(chainId: number): ChainType {
  const evmChains = [1, 56, 137];
  const solanaChains = [2];
  
  if (evmChains.includes(chainId)) {
    return 'evm';
  } else if (solanaChains.includes(chainId)) {
    return 'solana';
  } else {
    throw new Error('Unknown chain');
  }
}

describe('addressConversion', () => {
  test('should convert EVM address to 32 bytes', () => {
    const evmAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb';
    
    const bytes32 = evmAddressToBytes32(evmAddress);
    
    expect(bytes32).toHaveLength(32);
    expect(bytes32.subarray(12)).toEqual(
      Buffer.from(evmAddress.slice(2), 'hex')
    );
    
    for (let i = 0; i < 12; i++) {
      expect(bytes32[i]).toBe(0);
    }
  });
  
  test('should convert Solana address to 32 bytes', () => {
    const solanaAddress = '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs';
    
    const bytes32 = solanaAddressToBytes32(solanaAddress);
    
    expect(bytes32).toHaveLength(32);
  });
});

describe('chainTypeDetection', () => {
  test('should detect EVM chain', () => {
    expect(getChainType(1)).toBe('evm');
    expect(getChainType(56)).toBe('evm');
    expect(getChainType(137)).toBe('evm');
  });
  
  test('should detect Solana chain', () => {
    expect(getChainType(2)).toBe('solana');
  });
  
  test('should throw for unknown chain', () => {
    expect(() => getChainType(999)).toThrow('Unknown chain');
  });
});

