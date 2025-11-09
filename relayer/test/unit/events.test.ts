import { createMockReceipt, encodeLogMessagePublishedData } from '../utils/mocks';

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

const LOG_MESSAGE_PUBLISHED_TOPIC = '0x6eb224fb001ed210e379b335e35efe88672a8ce935d981a6896b27ffdf52a3b2';

function parseLogMessagePublished(receipt: TransactionReceipt): MessagePublishedEvent | null {
  const log = receipt.logs.find(log => 
    log.topics[0] === LOG_MESSAGE_PUBLISHED_TOPIC
  );
  
  if (!log) {
    return null;
  }
  
  const data = log.data.slice(2);
  let offset = 0;
  
  const senderHex = data.slice(offset, offset + 64);
  const sender = '0x' + senderHex.slice(24);
  offset += 64;
  
  const sequenceHex = data.slice(offset, offset + 16);
  const sequence = parseInt(sequenceHex, 16);
  offset += 16;
  
  const nonceHex = data.slice(offset, offset + 8);
  const nonce = parseInt(nonceHex, 16);
  offset += 8;
  
  const payloadLengthHex = data.slice(offset, offset + 64);
  const payloadLength = parseInt(payloadLengthHex, 16);
  offset += 64;
  
  const payloadHex = data.slice(offset, offset + payloadLength * 2);
  const payload = new Uint8Array(Buffer.from(payloadHex, 'hex'));
  offset += payloadLength * 2;
  
  const consistencyLevelHex = data.slice(offset, offset + 2);
  const consistencyLevel = parseInt(consistencyLevelHex, 16);
  
  return {
    sender,
    sequence,
    nonce,
    payload,
    consistencyLevel,
  };
}

describe('parseLogMessagePublished', () => {
  test('should parse LogMessagePublished event', () => {
    const receipt = createMockReceipt({
      logs: [
        {
          topics: [LOG_MESSAGE_PUBLISHED_TOPIC],
          data: encodeLogMessagePublishedData({
            sender: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
            sequence: 42,
            nonce: 0,
            payload: '0x' + Buffer.alloc(157, 0xaa).toString('hex'),
            consistencyLevel: 200,
          }),
        }
      ]
    });
    
    const event = parseLogMessagePublished(receipt);
    
    expect(event).toBeDefined();
    expect(event!.sender).toBe('0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb');
    expect(event!.sequence).toBe(42);
    expect(event!.nonce).toBe(0);
    expect(event!.consistencyLevel).toBe(200);
  });
  
  test('should return null when event not found', () => {
    const receipt = createMockReceipt({ logs: [] });
    
    const event = parseLogMessagePublished(receipt);
    
    expect(event).toBeNull();
  });
});

