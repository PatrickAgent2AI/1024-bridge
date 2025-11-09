import { generateTestVAA } from '../utils/vaa';

interface ParsedVAA {
  version: number;
  guardianSetIndex: number;
  signatures: Array<{
    guardianIndex: number;
    signature: Buffer;
  }>;
  timestamp: number;
  nonce: number;
  emitterChain: number;
  emitterAddress: Uint8Array;
  sequence: number;
  consistencyLevel: number;
  payload: Uint8Array;
}

function parseVAA(vaa: Uint8Array): ParsedVAA {
  if (!vaa || vaa.length < 6) {
    throw new Error('Invalid VAA format');
  }
  
  let offset = 0;
  
  const version = vaa[offset];
  offset += 1;
  
  const guardianSetIndex = (vaa[offset] << 24) | (vaa[offset + 1] << 16) | (vaa[offset + 2] << 8) | vaa[offset + 3];
  offset += 4;
  
  const signatureCount = vaa[offset];
  offset += 1;
  
  if (signatureCount < 13) {
    throw new Error('Insufficient signatures');
  }
  
  const signatures = [];
  for (let i = 0; i < signatureCount; i++) {
    const guardianIndex = vaa[offset];
    offset += 1;
    
    const signature = vaa.slice(offset, offset + 64);
    offset += 65;
    
    signatures.push({ guardianIndex, signature: Buffer.from(signature) });
  }
  
  const timestamp = (vaa[offset] << 24) | (vaa[offset + 1] << 16) | (vaa[offset + 2] << 8) | vaa[offset + 3];
  offset += 4;
  
  const nonce = (vaa[offset] << 24) | (vaa[offset + 1] << 16) | (vaa[offset + 2] << 8) | vaa[offset + 3];
  offset += 4;
  
  const emitterChain = (vaa[offset] << 8) | vaa[offset + 1];
  offset += 2;
  
  const emitterAddress = vaa.slice(offset, offset + 32);
  offset += 32;
  
  const sequenceHigh = (vaa[offset] << 24) | (vaa[offset + 1] << 16) | (vaa[offset + 2] << 8) | vaa[offset + 3];
  const sequenceLow = (vaa[offset + 4] << 24) | (vaa[offset + 5] << 16) | (vaa[offset + 6] << 8) | vaa[offset + 7];
  const sequence = sequenceLow;
  offset += 8;
  
  const consistencyLevel = vaa[offset];
  offset += 1;
  
  const payload = vaa.slice(offset);
  
  return {
    version,
    guardianSetIndex,
    signatures,
    timestamp,
    nonce,
    emitterChain,
    emitterAddress,
    sequence,
    consistencyLevel,
    payload,
  };
}

describe('parseVAA', () => {
  test('should parse valid VAA', () => {
    const vaa = generateTestVAA();
    
    const parsed = parseVAA(vaa);
    
    expect(parsed.version).toBe(1);
    expect(parsed.guardianSetIndex).toBe(0);
    expect(parsed.signatures).toHaveLength(13);
    expect(parsed.emitterChain).toBe(2);
    expect(parsed.sequence).toBe(42);
  });
  
  test('should throw error for invalid VAA', () => {
    const invalidVAA = new Uint8Array([0, 1, 2, 3]);
    
    expect(() => parseVAA(invalidVAA)).toThrow('Invalid VAA format');
  });
  
  test('should validate signature count', () => {
    const vaa = generateTestVAA({ signatureCount: 12 });
    
    expect(() => parseVAA(vaa)).toThrow('Insufficient signatures');
  });
});

