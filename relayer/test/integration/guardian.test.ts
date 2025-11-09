import nock from 'nock';
import { generateTestVAA } from '../utils/vaa';
import { testConfig } from '../config';

interface RelayerConfig {
  guardian: {
    url: string;
    timeout?: number;
    retryInterval?: number;
  };
  evm?: any;
  solana?: any;
}

interface FetchVAAOptions {
  timeout?: number;
  retryInterval?: number;
  onProgress?: (status: VAAStatus) => void;
}

interface VAAStatus {
  messageId: string;
  status: 'pending' | 'aggregating' | 'ready' | 'consumed';
  signatureCount: number;
  requiredSignatures: number;
  progress: number;
  guardiansSigned: number[];
}

class VAANotFoundError extends Error {
  constructor(public chainId: number, public emitter: string, public sequence: number) {
    super(`VAA not found for chain=${chainId}, emitter=${emitter}, sequence=${sequence}`);
    this.name = 'VAANotFoundError';
  }
}

class VAATimeoutError extends Error {
  constructor(public chainId: number, public emitter: string, public sequence: number, public timeout: number) {
    super(`VAA timeout after ${timeout}ms for chain=${chainId}, emitter=${emitter}, sequence=${sequence}`);
    this.name = 'VAATimeoutError';
  }
}

class RelayerSDK {
  constructor(private config: RelayerConfig) {}
  
  async fetchVAA(
    chainId: number,
    emitter: string,
    sequence: number,
    options?: FetchVAAOptions
  ): Promise<Uint8Array> {
    const timeout = options?.timeout || this.config.guardian.timeout || 300000;
    const retryInterval = options?.retryInterval || this.config.guardian.retryInterval || 5000;
    const startTime = Date.now();
    
    while (true) {
      try {
        const response = await fetch(
          `${this.config.guardian.url}/v1/signed_vaa/${chainId}/${emitter}/${sequence}`
        );
        
        if (response.status === 200) {
          const data = await response.json();
          const vaaHex = data.vaaBytes.startsWith('0x') ? data.vaaBytes.slice(2) : data.vaaBytes;
          return new Uint8Array(Buffer.from(vaaHex, 'hex'));
        } else if (response.status === 202) {
          if (Date.now() - startTime >= timeout) {
            throw new VAATimeoutError(chainId, emitter, sequence, timeout);
          }
          
          if (options?.onProgress) {
            const statusResponse = await fetch(
              `${this.config.guardian.url}/v1/vaa/status/${chainId}/${emitter}/${sequence}`
            );
            if (statusResponse.ok) {
              const status = await statusResponse.json();
              options.onProgress(status);
            }
          }
          
          await new Promise(resolve => setTimeout(resolve, retryInterval));
          continue;
        } else if (response.status === 404) {
          throw new VAANotFoundError(chainId, emitter, sequence);
        } else {
          throw new Error(`Guardian API error: ${response.status}`);
        }
      } catch (error) {
        if (error instanceof VAANotFoundError || error instanceof VAATimeoutError) {
          throw error;
        }
        throw error;
      }
    }
  }
}

describe('fetchVAA - Guardian Integration', () => {
  afterEach(() => {
    nock.cleanAll();
  });
  
  test('should fetch ready VAA from Guardian', async () => {
    nock('https://guardian.bridge.io')
      .get('/v1/signed_vaa/2/0x1111111111111111111111111111111111111111111111111111111111111111/42')
      .reply(200, {
        vaaBytes: '0x' + Buffer.from(generateTestVAA()).toString('hex'),
        vaa: {}
      });
    
    const relayer = new RelayerSDK(testConfig);
    
    const vaa = await relayer.fetchVAA(
      2,
      '0x' + '11'.repeat(32),
      42
    );
    
    expect(vaa).toBeDefined();
    expect(vaa).toBeInstanceOf(Uint8Array);
  }, 10000);
  
  test('should poll until VAA is ready', async () => {
    nock('https://guardian.bridge.io')
      .get('/v1/signed_vaa/2/0x1111111111111111111111111111111111111111111111111111111111111111/42')
      .times(2)
      .reply(202, 'VAA still aggregating');
    
    nock('https://guardian.bridge.io')
      .get('/v1/signed_vaa/2/0x1111111111111111111111111111111111111111111111111111111111111111/42')
      .reply(200, {
        vaaBytes: '0x' + Buffer.from(generateTestVAA()).toString('hex')
      });
    
    const relayer = new RelayerSDK({
      ...testConfig,
      guardian: {
        url: 'https://guardian.bridge.io',
        retryInterval: 1000,
      }
    });
    
    const startTime = Date.now();
    const vaa = await relayer.fetchVAA(2, '0x' + '11'.repeat(32), 42);
    const duration = Date.now() - startTime;
    
    expect(vaa).toBeDefined();
    expect(duration).toBeGreaterThanOrEqual(2000);
  }, 15000);
  
  test('should throw VAANotFoundError for 404', async () => {
    nock('https://guardian.bridge.io')
      .get('/v1/signed_vaa/2/0x1111111111111111111111111111111111111111111111111111111111111111/99')
      .reply(404, 'VAA not found');
    
    const relayer = new RelayerSDK(testConfig);
    
    await expect(
      relayer.fetchVAA(2, '0x' + '11'.repeat(32), 99)
    ).rejects.toThrow(VAANotFoundError);
  });
  
  test('should timeout after configured duration', async () => {
    nock('https://guardian.bridge.io')
      .get('/v1/signed_vaa/2/0x1111111111111111111111111111111111111111111111111111111111111111/42')
      .times(100)
      .reply(202, 'VAA still aggregating');
    
    const relayer = new RelayerSDK({
      ...testConfig,
      guardian: {
        url: 'https://guardian.bridge.io',
        timeout: 5000,
        retryInterval: 1000,
      }
    });
    
    await expect(
      relayer.fetchVAA(2, '0x' + '11'.repeat(32), 42)
    ).rejects.toThrow(VAATimeoutError);
  }, 10000);
});

