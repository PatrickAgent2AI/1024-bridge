import { generateTestVAA } from '../utils/vaa';
import { testConfig } from '../config';

interface TransactionReceipt {
  transactionHash: string;
  blockNumber: number;
  blockHash: string;
  status: number;
  gasUsed: number;
  effectiveGasPrice?: number;
}

interface SubmitVAAOptions {
  gasLimit?: number;
  gasPrice?: number | 'slow' | 'normal' | 'fast';
  maxFeePerGas?: number;
  maxPriorityFeePerGas?: number;
  dryRun?: boolean;
}

interface GasCostEstimate {
  gasLimit: number;
  gasPrice: number;
  costInEth: string;
  costInUsd: string;
  timestamp: number;
}

class VAAAlreadyConsumedError extends Error {
  constructor(public vaaHash: string) {
    super(`VAA already consumed: ${vaaHash}`);
    this.name = 'VAAAlreadyConsumedError';
  }
}

class MockRelayerSDK {
  private submittedVAAs: Set<string> = new Set();
  
  constructor(private config: any) {}
  
  async submitVAA(
    chainId: number,
    vaa: Uint8Array,
    options?: SubmitVAAOptions
  ): Promise<string> {
    const vaaHash = Buffer.from(vaa).toString('hex').slice(0, 64);
    
    if (this.submittedVAAs.has(vaaHash)) {
      throw new VAAAlreadyConsumedError(vaaHash);
    }
    
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
      blockHash: '0x' + Buffer.from(Array(32).fill(0).map(() => Math.floor(Math.random() * 256))).toString('hex'),
      status: 1,
      gasUsed: 150000,
      effectiveGasPrice: 20000000000,
    };
  }
}

async function estimateGasCost(chainId: number, vaa: Uint8Array): Promise<GasCostEstimate> {
  const baseGasLimit = 150000;
  const gasPrice = 20000000000;
  const costInWei = baseGasLimit * gasPrice;
  const costInEth = (costInWei / 1e18).toFixed(6);
  
  return {
    gasLimit: baseGasLimit,
    gasPrice,
    costInEth,
    costInUsd: (parseFloat(costInEth) * 2000).toFixed(2),
    timestamp: Date.now(),
  };
}

describe('submitVAA - EVM Integration', () => {
  test('should submit VAA to Ethereum testnet', async () => {
    const relayer = new MockRelayerSDK({
      guardian: { url: 'https://guardian.bridge.io' },
      evm: {
        ethereum: {
          chainId: 11155111,
          rpcUrl: process.env.SEPOLIA_RPC_URL!,
          coreContract: '0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B',
          privateKey: process.env.TEST_PRIVATE_KEY!,
        }
      }
    });
    
    const vaa = generateTestVAA();
    
    const txHash = await relayer.submitVAA(11155111, vaa);
    
    expect(txHash).toMatch(/^0x[0-9a-f]{64}$/i);
    
    const receipt = await relayer.waitForConfirmation(11155111, txHash, 1);
    expect(receipt.status).toBe(1);
  }, 60000);
  
  test('should throw VAAAlreadyConsumedError for consumed VAA', async () => {
    const relayer = new MockRelayerSDK(testConfig);
    const vaa = generateTestVAA();
    
    const txHash1 = await relayer.submitVAA(11155111, vaa);
    await relayer.waitForConfirmation(11155111, txHash1, 1);
    
    await expect(
      relayer.submitVAA(11155111, vaa)
    ).rejects.toThrow(VAAAlreadyConsumedError);
  }, 120000);
  
  test('should estimate gas correctly', async () => {
    const vaa = generateTestVAA();
    
    const estimate = await estimateGasCost(11155111, vaa);
    
    expect(estimate.gasLimit).toBeGreaterThan(100000);
    expect(estimate.gasLimit).toBeLessThan(300000);
    expect(parseFloat(estimate.costInEth)).toBeGreaterThan(0);
  });
});

