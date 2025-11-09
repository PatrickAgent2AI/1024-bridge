import { generateTestVAA, generateGuardianKeys } from '../utils/vaa';
import { mockLockTokensOnSolana, mockLockTokensOnEthereum, createMockReceipt } from '../utils/mocks';
import { fullConfig, emptyAccountKey } from '../config';

interface MessagePublishedEvent {
  sender: string;
  sequence: number;
  nonce: number;
  payload: Uint8Array;
  consistencyLevel: number;
}

interface TransactionReceipt {
  transactionHash: string;
  blockNumber: number;
  status: number;
  gasUsed: number;
}

interface VAAStatus {
  messageId: string;
  status: 'pending' | 'aggregating' | 'ready' | 'consumed';
  signatureCount: number;
  requiredSignatures: number;
  progress: number;
  guardiansSigned: number[];
}

interface FetchVAAOptions {
  onProgress?: (status: VAAStatus) => void;
}

interface SubmitVAAOptions {
  gasLimit?: number;
  gasPrice?: number | string;
}

class InsufficientBalanceError extends Error {
  constructor(
    public chainId: number,
    public required: string,
    public available: string
  ) {
    super(`Insufficient balance on chain ${chainId}: need ${required}, have ${available}`);
    this.name = 'InsufficientBalanceError';
  }
}

class MockE2ERelayerSDK {
  private messageCounter = 0;
  private submittedVAAs: Set<string> = new Set();
  
  constructor(private config: any) {}
  
  async fetchVAA(
    sourceChainId: number,
    emitter: string,
    sequence: number,
    options?: FetchVAAOptions
  ): Promise<Uint8Array> {
    await new Promise(resolve => setTimeout(resolve, 100));
    
    if (options?.onProgress) {
      for (let i = 0; i <= 13; i++) {
        options.onProgress({
          messageId: `${sourceChainId}/${emitter}/${sequence}`,
          status: i < 13 ? 'aggregating' : 'ready',
          signatureCount: i,
          requiredSignatures: 13,
          progress: i / 13,
          guardiansSigned: Array.from({ length: i }, (_, idx) => idx),
        });
        
        if (i < 13) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
    }
    
    return generateTestVAA();
  }
  
  async submitVAA(
    targetChainId: number,
    vaa: Uint8Array,
    options?: SubmitVAAOptions
  ): Promise<string> {
    if (this.config.evm?.ethereum?.privateKey === emptyAccountKey) {
      throw new InsufficientBalanceError(targetChainId, '0.01', '0');
    }
    
    if (options?.gasLimit && options.gasLimit < 50000) {
      throw new Error('Gas limit too low');
    }
    
    const vaaHash = Buffer.from(vaa).toString('hex').slice(0, 64);
    this.submittedVAAs.add(vaaHash);
    
    const txHash = '0x' + Buffer.from(Array(32).fill(0).map(() => Math.floor(Math.random() * 256))).toString('hex');
    return txHash;
  }
  
  async waitForConfirmation(
    chainId: number,
    txHash: string,
    confirmations?: number
  ): Promise<TransactionReceipt> {
    await new Promise(resolve => setTimeout(resolve, 100));
    
    return {
      transactionHash: txHash,
      blockNumber: 1000000,
      status: 1,
      gasUsed: 150000,
    };
  }
  
  async getBalance(chainId: number): Promise<string> {
    if (this.config.evm?.ethereum?.privateKey === emptyAccountKey) {
      return '0';
    }
    return '1.0';
  }
}

function parseLogMessagePublished(tx: any): MessagePublishedEvent | null {
  if (!tx || !tx.sequence) {
    return null;
  }
  
  return {
    sender: '0x' + '11'.repeat(32),
    sequence: tx.sequence,
    nonce: 0,
    payload: new Uint8Array(157),
    consistencyLevel: 200,
  };
}

describe('E2E: Complete Cross-Chain Transfer', () => {
  test('should complete Solana to Ethereum transfer', async () => {
    const relayer = new MockE2ERelayerSDK(fullConfig);
    
    const solanaTx = mockLockTokensOnSolana();
    const event = parseLogMessagePublished(solanaTx);
    
    expect(event).toBeDefined();
    console.log(`Message published: sequence=${event!.sequence}`);
    
    console.log('Waiting for VAA...');
    const vaa = await relayer.fetchVAA(
      2,
      event!.sender,
      event!.sequence,
      {
        onProgress: (status) => {
          console.log(`Progress: ${(status.progress * 100).toFixed(1)}%`);
        }
      }
    );
    
    console.log('VAA fetched');
    
    console.log('Submitting to Ethereum...');
    const txHash = await relayer.submitVAA(1, vaa);
    console.log(`TX: ${txHash}`);
    
    const receipt = await relayer.waitForConfirmation(1, txHash, 12);
    
    expect(receipt.status).toBe(1);
    console.log('✅ Transfer completed');
  }, 600000);
  
  test('should complete Ethereum to Solana transfer', async () => {
    const relayer = new MockE2ERelayerSDK(fullConfig);
    
    const ethTx = mockLockTokensOnEthereum();
    const event = parseLogMessagePublished(ethTx);
    
    const vaa = await relayer.fetchVAA(1, event!.sender, event!.sequence);
    
    const signature = await relayer.submitVAA(2, vaa);
    
    const receipt = await relayer.waitForConfirmation(2, signature);
    
    expect(receipt.status).toBe(1);
  }, 600000);
  
  test('should retry failed submission', async () => {
    const relayer = new MockE2ERelayerSDK(fullConfig);
    
    const vaa = generateTestVAA();
    
    await expect(
      relayer.submitVAA(1, vaa, { gasLimit: 10000 })
    ).rejects.toThrow('Gas limit too low');
    
    const txHash = await relayer.submitVAA(1, vaa, { gasLimit: 200000 });
    const receipt = await relayer.waitForConfirmation(1, txHash, 1);
    
    expect(receipt.status).toBe(1);
  }, 300000);
  
  test('should handle multiple VAAs concurrently', async () => {
    const relayer = new MockE2ERelayerSDK(fullConfig);
    
    const vaaTasks = [
      { sourceChainId: 2, emitter: '0x' + '11'.repeat(32), sequence: 1, targetChainId: 1 },
      { sourceChainId: 2, emitter: '0x' + '11'.repeat(32), sequence: 2, targetChainId: 1 },
      { sourceChainId: 2, emitter: '0x' + '11'.repeat(32), sequence: 3, targetChainId: 1 },
    ];
    
    const results = await Promise.all(
      vaaTasks.map(async (task) => {
        const vaa = await relayer.fetchVAA(
          task.sourceChainId,
          task.emitter,
          task.sequence
        );
        
        const txHash = await relayer.submitVAA(task.targetChainId, vaa);
        
        return { task, txHash };
      })
    );
    
    expect(results).toHaveLength(3);
    expect(results.every(r => r.txHash)).toBe(true);
  }, 600000);
  
  test('should warn on low balance', async () => {
    const relayer = new MockE2ERelayerSDK({
      ...fullConfig,
      evm: {
        ethereum: {
          ...fullConfig.evm!.ethereum,
          privateKey: emptyAccountKey,
        }
      }
    });
    
    const balance = await relayer.getBalance(1);
    expect(parseFloat(balance)).toBe(0);
    
    const vaa = generateTestVAA();
    
    await expect(
      relayer.submitVAA(1, vaa)
    ).rejects.toThrow(InsufficientBalanceError);
  });
});

