import keccakPkg from 'js-sha3';
import elliptic from 'elliptic';
import * as crypto from 'crypto';

const { keccak256 } = keccakPkg;
const EC = elliptic.ec;
const ec = new EC('secp256k1');

export interface GuardianKeyPair {
  privateKey: Buffer;
  publicKey: Buffer;
  address: Buffer;
}

export interface VAA {
  version: number;
  guardianSetIndex: number;
  signatures: Signature[];
  timestamp: number;
  nonce: number;
  emitterChain: number;
  emitterAddress: Buffer;
  sequence: bigint;
  consistencyLevel: number;
  payload: Buffer;
}

export interface Signature {
  guardianIndex: number;
  r: Buffer;
  s: Buffer;
  v: number;
}

export interface TokenTransferPayload {
  payloadType: number;
  amount: bigint;
  tokenAddress: Buffer;
  tokenChain: number;
  recipient: Buffer;
  recipientChain: number;
  targetToken: Buffer;
  targetAmount: bigint;
  exchangeRateNum: bigint;
  exchangeRateDenom: bigint;
}

export function serializeTokenTransferPayload(payload: TokenTransferPayload): Buffer {
  const buffer = Buffer.alloc(157);
  let offset = 0;
  
  buffer.writeUInt8(payload.payloadType, offset);
  offset += 1;
  
  const amountBuffer = Buffer.alloc(32);
  const amountHex = payload.amount.toString(16).padStart(64, '0');
  Buffer.from(amountHex, 'hex').copy(amountBuffer);
  amountBuffer.copy(buffer, offset);
  offset += 32;
  
  payload.tokenAddress.copy(buffer, offset);
  offset += 32;
  
  buffer.writeUInt16BE(payload.tokenChain, offset);
  offset += 2;
  
  payload.recipient.copy(buffer, offset);
  offset += 32;
  
  buffer.writeUInt16BE(payload.recipientChain, offset);
  offset += 2;
  
  payload.targetToken.copy(buffer, offset);
  offset += 32;
  
  const targetAmountBuffer = Buffer.alloc(8);
  targetAmountBuffer.writeBigUInt64BE(payload.targetAmount);
  targetAmountBuffer.copy(buffer, offset);
  offset += 8;
  
  const rateNumBuffer = Buffer.alloc(8);
  rateNumBuffer.writeBigUInt64BE(payload.exchangeRateNum);
  rateNumBuffer.copy(buffer, offset);
  offset += 8;
  
  const rateDenomBuffer = Buffer.alloc(8);
  rateDenomBuffer.writeBigUInt64BE(payload.exchangeRateDenom);
  rateDenomBuffer.copy(buffer, offset);
  
  return buffer;
}

export function serializeVAABody(vaa: Omit<VAA, 'version' | 'guardianSetIndex' | 'signatures'>): Buffer {
  const buffer = Buffer.alloc(51 + vaa.payload.length);
  let offset = 0;
  
  buffer.writeUInt32BE(vaa.timestamp, offset);
  offset += 4;
  
  buffer.writeUInt32BE(vaa.nonce, offset);
  offset += 4;
  
  buffer.writeUInt16BE(vaa.emitterChain, offset);
  offset += 2;
  
  vaa.emitterAddress.copy(buffer, offset);
  offset += 32;
  
  const sequenceBuffer = Buffer.alloc(8);
  sequenceBuffer.writeBigUInt64BE(vaa.sequence);
  sequenceBuffer.copy(buffer, offset);
  offset += 8;
  
  buffer.writeUInt8(vaa.consistencyLevel, offset);
  offset += 1;
  
  vaa.payload.copy(buffer, offset);
  
  return buffer;
}

export function hashVAABody(bodyBuffer: Buffer): Buffer {
  return Buffer.from(keccak256(bodyBuffer), 'hex');
}

export function generateGuardianKey(seed?: Buffer): GuardianKeyPair {
  const privateKey = seed || Buffer.from(crypto.randomBytes(32));
  const key = ec.keyFromPrivate(Array.from(privateKey));
  
  const publicKeyPoint = key.getPublic();
  const publicKey = Buffer.concat([
    Buffer.from(publicKeyPoint.getX().toArray('be', 32)),
    Buffer.from(publicKeyPoint.getY().toArray('be', 32))
  ]);
  
  const publicKeyHash = Buffer.from(keccak256(publicKey), 'hex');
  const address = publicKeyHash.slice(-20);
  
  return {
    privateKey,
    publicKey,
    address,
  };
}

export function generateGuardianKeys(count: number): GuardianKeyPair[] {
  const keys: GuardianKeyPair[] = [];
  for (let i = 0; i < count; i++) {
    const seed = Buffer.alloc(32);
    seed.writeUInt32BE(i + 1, 0);
    seed.writeUInt32BE(0x12345678, 4);
    seed.writeUInt32BE(i * 0x1000 + 0x8888, 8);
    keys.push(generateGuardianKey(seed));
  }
  return keys;
}

export function signVAA(bodyHash: Buffer, guardianKey: GuardianKeyPair, guardianIndex: number): Signature {
  const key = ec.keyFromPrivate(guardianKey.privateKey);
  const signature = key.sign(bodyHash, { canonical: true });
  const recoveryParam = signature.recoveryParam!;
  
  return {
    guardianIndex,
    r: Buffer.from(signature.r.toArray('be', 32)),
    s: Buffer.from(signature.s.toArray('be', 32)),
    v: recoveryParam,
  };
}

export function serializeVAA(vaa: VAA): Buffer {
  const bodyBuffer = serializeVAABody(vaa);
  const signaturesLength = vaa.signatures.length;
  
  const totalLength = 6 + signaturesLength * 66 + bodyBuffer.length;
  const buffer = Buffer.alloc(totalLength);
  let offset = 0;
  
  buffer.writeUInt8(vaa.version, offset);
  offset += 1;
  
  buffer.writeUInt32BE(vaa.guardianSetIndex, offset);
  offset += 4;
  
  buffer.writeUInt8(signaturesLength, offset);
  offset += 1;
  
  for (const sig of vaa.signatures) {
    buffer.writeUInt8(sig.guardianIndex, offset);
    offset += 1;
    
    sig.r.copy(buffer, offset);
    offset += 32;
    
    sig.s.copy(buffer, offset);
    offset += 32;
    
    buffer.writeUInt8(sig.v, offset);
    offset += 1;
  }
  
  bodyBuffer.copy(buffer, offset);
  
  return buffer;
}

export function createTestVAA(params: {
  guardianSetIndex: number;
  emitterChain: number;
  emitterAddress: Buffer;
  sequence: bigint;
  payload: Buffer;
  guardianKeys: GuardianKeyPair[];
  signerCount?: number;
  timestamp?: number;
  nonce?: number;
  consistencyLevel?: number;
}): Buffer {
  const timestamp = params.timestamp || Math.floor(Date.now() / 1000);
  const nonce = params.nonce || 0;
  const consistencyLevel = params.consistencyLevel || 200;
  const signerCount = params.signerCount || 13;
  
  const bodyBuffer = serializeVAABody({
    timestamp,
    nonce,
    emitterChain: params.emitterChain,
    emitterAddress: params.emitterAddress,
    sequence: params.sequence,
    consistencyLevel,
    payload: params.payload,
  });
  
  const bodyHash = hashVAABody(bodyBuffer);
  const doubleHash = Buffer.from(keccak256(bodyHash), 'hex');
  
  const signatures: Signature[] = [];
  const actualSignerCount = Math.min(params.guardianKeys.length, signerCount);
  
  for (let i = 0; i < actualSignerCount; i++) {
    const signature = signVAA(doubleHash, params.guardianKeys[i], i);
    signatures.push(signature);
  }
  
  const vaa: VAA = {
    version: 1,
    guardianSetIndex: params.guardianSetIndex,
    signatures,
    timestamp,
    nonce,
    emitterChain: params.emitterChain,
    emitterAddress: params.emitterAddress,
    sequence: params.sequence,
    consistencyLevel,
    payload: params.payload,
  };
  
  return serializeVAA(vaa);
}

export function generateTestVAA(options?: {
  emitterChain?: number;
  sequence?: number;
  signatureCount?: number;
}): Uint8Array {
  const guardianKeys = generateGuardianKeys(19);
  const emitterAddress = Buffer.alloc(32, 0x11);
  
  const payload = serializeTokenTransferPayload({
    payloadType: 1,
    amount: BigInt(1000_000_000),
    tokenAddress: Buffer.alloc(32, 0xaa),
    tokenChain: 1,
    recipient: Buffer.alloc(32, 0xbb),
    recipientChain: 2,
    targetToken: Buffer.alloc(32, 0xcc),
    targetAmount: BigInt(1000_000_000),
    exchangeRateNum: BigInt(1),
    exchangeRateDenom: BigInt(1),
  });
  
  const vaa = createTestVAA({
    guardianSetIndex: 0,
    emitterChain: options?.emitterChain || 2,
    emitterAddress,
    sequence: BigInt(options?.sequence || 42),
    payload,
    guardianKeys,
    signerCount: options?.signatureCount || 13,
  });
  
  return new Uint8Array(vaa);
}

