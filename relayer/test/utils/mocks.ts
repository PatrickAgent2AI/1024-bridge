export interface MockReceipt {
  transactionHash: string;
  blockNumber: number;
  blockHash: string;
  status: number;
  gasUsed: number;
  effectiveGasPrice?: number;
  logs: Array<{
    topics: string[];
    data: string;
    address?: string;
  }>;
}

export function createMockReceipt(overrides?: Partial<MockReceipt>): MockReceipt {
  return {
    transactionHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    blockNumber: 1000000,
    blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    status: 1,
    gasUsed: 150000,
    effectiveGasPrice: 20000000000,
    logs: [],
    ...overrides,
  };
}

export interface MockTransaction {
  hash: string;
  from: string;
  to: string;
  value: string;
  gasLimit: number;
  gasPrice: string;
}

export function createMockTransaction(overrides?: Partial<MockTransaction>): MockTransaction {
  return {
    hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    from: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
    to: '0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B',
    value: '0',
    gasLimit: 200000,
    gasPrice: '20000000000',
    ...overrides,
  };
}

export function mockLockTokensOnSolana(): any {
  const receipt = createMockReceipt({
    logs: [
      {
        topics: [
          '0x6eb224fb001ed210e379b335e35efe88672a8ce935d981a6896b27ffdf52a3b2',
        ],
        data: '0x' + Buffer.alloc(32, 0x11).toString('hex'),
      },
    ],
  });
  
  return {
    ...receipt,
    sequence: 42,
  };
}

export function mockLockTokensOnEthereum(): any {
  return mockLockTokensOnSolana();
}

export function encodeLogMessagePublishedData(params: {
  sender: string;
  sequence: number;
  nonce: number;
  payload: string;
  consistencyLevel: number;
}): string {
  const senderHex = params.sender.slice(2).padStart(64, '0');
  const sequenceHex = params.sequence.toString(16).padStart(16, '0');
  const nonceHex = params.nonce.toString(16).padStart(8, '0');
  const consistencyLevelHex = params.consistencyLevel.toString(16).padStart(2, '0');
  const payloadLengthHex = (params.payload.length / 2).toString(16).padStart(64, '0');
  
  return '0x' + senderHex + sequenceHex + nonceHex + payloadLengthHex + params.payload.slice(2) + consistencyLevelHex;
}

