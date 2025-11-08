/**
 * VAA构造工具
 * 用于测试中生成真实的VAA（Verified Action Approval）
 * 
 * 实现说明：
 * - Guardian使用secp256k1密钥对（与Ethereum兼容）
 * - VAA签名使用ECDSA secp256k1算法
 * - Body哈希使用Keccak256（与Solidity keccak256一致）
 * - 完全模拟Wormhole的VAA格式和验证流程
 */

import { Keypair, PublicKey } from "@solana/web3.js";
import keccakPkg from "js-sha3";
import elliptic from "elliptic";
import * as crypto from "crypto";

const { keccak256 } = keccakPkg;
const EC = elliptic.ec;
const ec = new EC("secp256k1");

/**
 * Guardian密钥对（secp256k1）
 */
export interface GuardianKeyPair {
  privateKey: Buffer;   // 32 bytes
  publicKey: Buffer;    // 64 bytes uncompressed (without 0x04 prefix)
  address: Buffer;      // 20 bytes Ethereum address
}

/**
 * VAA结构定义
 */
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

/**
 * 签名结构
 */
export interface Signature {
  guardianIndex: number;
  r: Buffer;
  s: Buffer;
  v: number;
}

/**
 * TokenTransfer Payload结构（新版本 - 支持跨链兑换）
 */
export interface TokenTransferPayload {
  payloadType: number;       // 1 = token transfer with exchange
  amount: bigint;            // 源链锁定数量
  tokenAddress: Buffer;      // 32 bytes 源链代币地址
  tokenChain: number;        // 源链ID
  recipient: Buffer;         // 32 bytes 接收者地址
  recipientChain: number;    // 目标链ID
  // 新增兑换字段
  targetToken?: Buffer;      // 32 bytes 目标链代币地址（可选，用于多对多兑换）
  targetAmount?: bigint;     // 目标链接收数量（可选）
  exchangeRateNum?: bigint;  // 兑换比率分子（可选）
  exchangeRateDenom?: bigint;// 兑换比率分母（可选）
}

/**
 * GuardianSetUpgrade Payload结构
 */
export interface GuardianSetUpgradePayload {
  module: number;             // 0x01 (Core)
  action: number;             // 0x02 (GuardianSetUpgrade)
  chain: number;              // 0 (all chains) or chain id
  newGuardianSetIndex: number;
  newGuardians: Buffer[];     // Array of 20-byte addresses
}

/**
 * 序列化TokenTransfer Payload（新版本 - 133字节，包含兑换信息）
 */
export function serializeTokenTransferPayload(payload: TokenTransferPayload): Buffer {
  // 根据是否有兑换字段决定使用新格式(133字节)还是旧格式(77字节)
  const hasExchangeFields = payload.targetToken !== undefined;
  const bufferSize = hasExchangeFields ? 133 : 77;
  const buffer = Buffer.alloc(bufferSize);
  let offset = 0;
  
  // payloadType: uint8
  buffer.writeUInt8(payload.payloadType, offset);
  offset += 1;
  
  // amount: uint256 (32 bytes big-endian)
  const amountBuffer = Buffer.alloc(32);
  const amountHex = payload.amount.toString(16).padStart(64, '0');
  Buffer.from(amountHex, 'hex').copy(amountBuffer);
  amountBuffer.copy(buffer, offset);
  offset += 32;
  
  // tokenAddress: 32 bytes
  payload.tokenAddress.copy(buffer, offset);
  offset += 32;
  
  // tokenChain: uint16
  buffer.writeUInt16BE(payload.tokenChain, offset);
  offset += 2;
  
  // recipient: 32 bytes
  payload.recipient.copy(buffer, offset);
  offset += 32;
  
  // recipientChain: uint16
  buffer.writeUInt16BE(payload.recipientChain, offset);
  offset += 2;
  
  // 如果有兑换字段，继续写入
  if (hasExchangeFields) {
    // targetToken: 32 bytes
    payload.targetToken!.copy(buffer, offset);
    offset += 32;
    
    // targetAmount: uint64 (8 bytes big-endian)
    const targetAmountBuffer = Buffer.alloc(8);
    targetAmountBuffer.writeBigUInt64BE(payload.targetAmount || BigInt(0));
    targetAmountBuffer.copy(buffer, offset);
    offset += 8;
    
    // exchangeRateNum: uint64 (8 bytes big-endian)
    const rateNumBuffer = Buffer.alloc(8);
    rateNumBuffer.writeBigUInt64BE(payload.exchangeRateNum || BigInt(1));
    rateNumBuffer.copy(buffer, offset);
    offset += 8;
    
    // exchangeRateDenom: uint64 (8 bytes big-endian)
    const rateDenomBuffer = Buffer.alloc(8);
    rateDenomBuffer.writeBigUInt64BE(payload.exchangeRateDenom || BigInt(1));
    rateDenomBuffer.copy(buffer, offset);
  }
  
  return buffer;
}

/**
 * 序列化GuardianSetUpgrade Payload
 */
export function serializeGuardianSetUpgradePayload(payload: GuardianSetUpgradePayload): Buffer {
  const guardianCount = payload.newGuardians.length;
  const buffer = Buffer.alloc(6 + guardianCount * 20); // module + action + chain + index + guardians
  let offset = 0;
  
  buffer.writeUInt8(payload.module, offset);
  offset += 1;
  
  buffer.writeUInt8(payload.action, offset);
  offset += 1;
  
  buffer.writeUInt16BE(payload.chain, offset);
  offset += 2;
  
  buffer.writeUInt32BE(payload.newGuardianSetIndex, offset);
  offset += 4;
  
  // 写入Guardian地址（每个20字节）
  for (const guardian of payload.newGuardians) {
    guardian.copy(buffer, offset);
    offset += 20;
  }
  
  return buffer;
}

/**
 * 序列化VAA Body
 */
export function serializeVAABody(vaa: Omit<VAA, "version" | "guardianSetIndex" | "signatures">): Buffer {
  const buffer = Buffer.alloc(51 + vaa.payload.length);
  let offset = 0;
  
  // timestamp: uint32
  buffer.writeUInt32BE(vaa.timestamp, offset);
  offset += 4;
  
  // nonce: uint32
  buffer.writeUInt32BE(vaa.nonce, offset);
  offset += 4;
  
  // emitterChain: uint16
  buffer.writeUInt16BE(vaa.emitterChain, offset);
  offset += 2;
  
  // emitterAddress: 32 bytes
  vaa.emitterAddress.copy(buffer, offset);
  offset += 32;
  
  // sequence: uint64
  const sequenceBuffer = Buffer.alloc(8);
  sequenceBuffer.writeBigUInt64BE(vaa.sequence);
  sequenceBuffer.copy(buffer, offset);
  offset += 8;
  
  // consistencyLevel: uint8
  buffer.writeUInt8(vaa.consistencyLevel, offset);
  offset += 1;
  
  // payload
  vaa.payload.copy(buffer, offset);
  
  return buffer;
}

/**
 * 对VAA Body进行Keccak256哈希
 */
export function hashVAABody(bodyBuffer: Buffer): Buffer {
  return Buffer.from(keccak256(bodyBuffer), 'hex');
}

/**
 * 生成Guardian密钥对（secp256k1）
 */
export function generateGuardianKey(seed?: Buffer): GuardianKeyPair {
  const privateKey = seed || Buffer.from(crypto.randomBytes(32));
  const key = ec.keyFromPrivate(Array.from(privateKey));
  
  // 获取公钥（uncompressed，64字节，不含0x04前缀）
  const publicKeyPoint = key.getPublic();
  const publicKey = Buffer.concat([
    Buffer.from(publicKeyPoint.getX().toArray('be', 32)),
    Buffer.from(publicKeyPoint.getY().toArray('be', 32))
  ]);
  
  // 计算Ethereum地址（公钥keccak256哈希的后20字节）
  const publicKeyHash = Buffer.from(keccak256(publicKey), 'hex');
  const address = publicKeyHash.slice(-20);
  
  return {
    privateKey,
    publicKey,
    address,
  };
}

/**
 * 批量生成Guardian密钥对
 */
export function generateGuardianKeys(count: number): GuardianKeyPair[] {
  const keys: GuardianKeyPair[] = [];
  for (let i = 0; i < count; i++) {
    // 使用确定性种子便于测试重现
    // 避免全0种子，使用哈希生成有效的私钥
    const seed = Buffer.alloc(32);
    seed.writeUInt32BE(i + 1, 0);  // 从1开始避免全0
    seed.writeUInt32BE(0x12345678, 4); // 添加固定magic number
    seed.writeUInt32BE(i * 0x1000 + 0x8888, 8); // 添加变化值
    keys.push(generateGuardianKey(seed));
  }
  return keys;
}

/**
 * 使用Guardian密钥对VAA签名（ECDSA secp256k1）
 */
export function signVAA(bodyHash: Buffer, guardianKey: GuardianKeyPair, guardianIndex: number): Signature {
  const key = ec.keyFromPrivate(guardianKey.privateKey);
  
  // 签名（canonical格式，与Ethereum兼容）
  const signature = key.sign(bodyHash, { canonical: true });
  
  // 计算recovery ID (v)
  const recoveryParam = signature.recoveryParam!;
  
  return {
    guardianIndex,
    r: Buffer.from(signature.r.toArray('be', 32)),
    s: Buffer.from(signature.s.toArray('be', 32)),
    v: recoveryParam,
  };
}

/**
 * 验证VAA签名（用于测试验证）
 */
export function verifyVAASignature(
  bodyHash: Buffer,
  signature: Signature,
  guardianAddress: Buffer
): boolean {
  try {
    // 从签名恢复公钥
    const key = ec.recoverPubKey(
      bodyHash,
      {
        r: signature.r,
        s: signature.s,
      },
      signature.v
    );
    
    // 获取公钥
    const publicKey = Buffer.concat([
      Buffer.from(key.getX().toArray('be', 32)),
      Buffer.from(key.getY().toArray('be', 32))
    ]);
    
    // 计算地址
    const publicKeyHash = Buffer.from(keccak256(publicKey), 'hex');
    const recoveredAddress = publicKeyHash.slice(-20);
    
    // 比较地址
    return recoveredAddress.equals(guardianAddress);
  } catch (error) {
    return false;
  }
}

/**
 * 序列化完整VAA
 */
export function serializeVAA(vaa: VAA): Buffer {
  const bodyBuffer = serializeVAABody(vaa);
  const signaturesLength = vaa.signatures.length;
  
  // Header: version(1) + guardianSetIndex(4) + signaturesLen(1)
  // Signatures: signaturesLen * 66 bytes (index(1) + r(32) + s(32) + v(1))
  // Body: bodyBuffer.length
  const totalLength = 6 + signaturesLength * 66 + bodyBuffer.length;
  const buffer = Buffer.alloc(totalLength);
  let offset = 0;
  
  // version: uint8
  buffer.writeUInt8(vaa.version, offset);
  offset += 1;
  
  // guardianSetIndex: uint32
  buffer.writeUInt32BE(vaa.guardianSetIndex, offset);
  offset += 4;
  
  // signaturesLen: uint8
  buffer.writeUInt8(signaturesLength, offset);
  offset += 1;
  
  // signatures
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
  
  // body
  bodyBuffer.copy(buffer, offset);
  
  return buffer;
}

/**
 * 创建测试VAA（使用真实的Guardian密钥）
 */
export function createTestVAA(params: {
  guardianSetIndex: number;
  emitterChain: number;
  emitterAddress: Buffer;
  sequence: bigint;
  payload: Buffer;
  guardianKeys: GuardianKeyPair[];  // Guardian密钥，至少13个用于签名
  signerCount?: number;             // 签名数量，默认13
  timestamp?: number;
  nonce?: number;
  consistencyLevel?: number;
}): Buffer {
  const timestamp = params.timestamp || Math.floor(Date.now() / 1000);
  const nonce = params.nonce || 0;
  const consistencyLevel = params.consistencyLevel || 32;
  const signerCount = params.signerCount || 13;
  
  // 序列化Body
  const bodyBuffer = serializeVAABody({
    timestamp,
    nonce,
    emitterChain: params.emitterChain,
    emitterAddress: params.emitterAddress,
    sequence: params.sequence,
    consistencyLevel,
    payload: params.payload,
  });
  
  // 计算Body哈希（双重哈希：keccak256(keccak256(body))）
  const bodyHash = hashVAABody(bodyBuffer);
  const doubleHash = Buffer.from(keccak256(bodyHash), 'hex');
  
  // 生成签名（前N个Guardian）
  const signatures: Signature[] = [];
  const actualSignerCount = Math.min(params.guardianKeys.length, signerCount);
  
  for (let i = 0; i < actualSignerCount; i++) {
    const signature = signVAA(doubleHash, params.guardianKeys[i], i);
    signatures.push(signature);
  }
  
  // 序列化完整VAA
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

/**
 * 创建Token Transfer VAA
 */
export function createTokenTransferVAA(params: {
  guardianSetIndex: number;
  emitterChain: number;
  emitterAddress: Buffer;
  sequence: bigint;
  guardianKeys: GuardianKeyPair[];
  transferPayload: TokenTransferPayload;
  signerCount?: number;
}): Buffer {
  const payload = serializeTokenTransferPayload(params.transferPayload);
  
  return createTestVAA({
    guardianSetIndex: params.guardianSetIndex,
    emitterChain: params.emitterChain,
    emitterAddress: params.emitterAddress,
    sequence: params.sequence,
    payload,
    guardianKeys: params.guardianKeys,
    signerCount: params.signerCount,
  });
}

/**
 * 创建Guardian Set Upgrade VAA
 */
export function createGuardianSetUpgradeVAA(params: {
  guardianSetIndex: number;
  emitterChain: number;
  emitterAddress: Buffer;
  sequence: bigint;
  guardianKeys: GuardianKeyPair[];
  upgradePayload: GuardianSetUpgradePayload;
  signerCount?: number;
}): Buffer {
  const payload = serializeGuardianSetUpgradePayload(params.upgradePayload);
  
  return createTestVAA({
    guardianSetIndex: params.guardianSetIndex,
    emitterChain: params.emitterChain,
    emitterAddress: params.emitterAddress,
    sequence: params.sequence,
    payload,
    guardianKeys: params.guardianKeys,
    signerCount: params.signerCount,
  });
}

/**
 * 解析VAA获取Body哈希（用于验证）
 */
export function parseVAABodyHash(vaaBuffer: Buffer): Buffer {
  // 跳过header和signatures
  let offset = 0;
  
  // version (1) + guardian_set_index (4)
  offset += 5;
  
  // signatures_len (1)
  const signaturesLen = vaaBuffer.readUInt8(offset);
  offset += 1;
  
  // signatures (66 * N)
  offset += signaturesLen * 66;
  
  // 剩余的就是body
  const body = vaaBuffer.slice(offset);
  
  // 返回double hash
  const bodyHash = hashVAABody(body);
  return Buffer.from(keccak256(bodyHash), 'hex');
}

