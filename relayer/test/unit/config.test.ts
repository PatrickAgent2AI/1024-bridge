import { testConfig } from '../config';

interface RelayerConfig {
  guardian: {
    url: string;
    timeout?: number;
    retryInterval?: number;
  };
  evm?: Record<string, {
    chainId: number;
    rpcUrl: string;
    coreContract: string;
    privateKey: string;
    confirmations?: number;
  }>;
  solana?: {
    chainId: number;
    rpcUrl: string;
    bridgeProgram: string;
    payerKeypair: any;
    commitment?: string;
  };
}

class RelayerSDK {
  constructor(public config: RelayerConfig) {
    if (!config.guardian?.url) {
      throw new Error('Guardian URL is required');
    }
    
    if (config.evm) {
      for (const [chain, chainConfig] of Object.entries(config.evm)) {
        if (chainConfig.privateKey && !this.isValidPrivateKey(chainConfig.privateKey)) {
          throw new Error('Invalid private key');
        }
      }
    }
  }
  
  private isValidPrivateKey(key: string): boolean {
    if (!key.startsWith('0x')) return false;
    if (key.length !== 66) return false;
    return /^0x[0-9a-fA-F]{64}$/.test(key);
  }
}

describe('RelayerSDK Configuration', () => {
  test('should accept valid configuration', () => {
    const config: RelayerConfig = {
      guardian: { url: 'https://guardian.bridge.io' },
      evm: {
        ethereum: {
          chainId: 1,
          rpcUrl: 'https://eth.llamarpc.com',
          coreContract: '0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B',
          privateKey: '0x' + '11'.repeat(32),
        }
      }
    };
    
    const relayer = new RelayerSDK(config);
    expect(relayer).toBeDefined();
    expect(relayer.config.guardian.url).toBe('https://guardian.bridge.io');
  });
  
  test('should throw error for missing guardian URL', () => {
    const config: any = {
      guardian: { url: '' },
      evm: {
        ethereum: {
          chainId: 1,
          rpcUrl: 'https://eth.llamarpc.com',
          coreContract: '0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B',
          privateKey: '0x' + '11'.repeat(32),
        }
      }
    };
    
    expect(() => new RelayerSDK(config)).toThrow('Guardian URL is required');
  });
  
  test('should throw error for invalid private key', () => {
    const config: RelayerConfig = {
      guardian: { url: 'https://guardian.bridge.io' },
      evm: {
        ethereum: {
          chainId: 1,
          rpcUrl: 'https://eth.llamarpc.com',
          coreContract: '0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B',
          privateKey: 'invalid-key',
        }
      }
    };
    
    expect(() => new RelayerSDK(config)).toThrow('Invalid private key');
  });
});

