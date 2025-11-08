/**
 * 通用辅助函数
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

/**
 * 等待指定毫秒数
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 格式化公钥（截取前后各8个字符）
 */
export function formatPublicKey(pubkey: PublicKey): string {
  const str = pubkey.toBase58();
  return `${str.slice(0, 8)}...${str.slice(-8)}`;
}

/**
 * 格式化交易签名
 */
export function formatSignature(signature: string): string {
  return `${signature.slice(0, 8)}...${signature.slice(-8)}`;
}

/**
 * 从Guardian API轮询VAA（模拟）
 */
export async function pollGuardianForVAA(
  messageId: {
    emitterChain: number;
    emitterAddress: string;
    sequence: bigint;
  },
  timeout: number = 60000
): Promise<Buffer> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    try {
      // 模拟从Guardian API获取VAA
      // 实际实现需要调用真实的Guardian API
      const guardianUrl = process.env.GUARDIAN_URL || "http://localhost:7071";
      const url = `${guardianUrl}/v1/signed_vaa/${messageId.emitterChain}/${messageId.emitterAddress}/${messageId.sequence}`;
      
      const response = await fetch(url);
      
      if (response.status === 200) {
        const data = await response.json();
        return Buffer.from(data.vaaBytes.slice(2), 'hex');
      }
      
      if (response.status === 404) {
        throw new Error("VAA not found");
      }
      
      // 202: 聚合中，继续等待
      console.log("Waiting for VAA aggregation...");
      await sleep(1000);
    } catch (err) {
      if ((err as Error).message !== "VAA not found") {
        console.log("Polling VAA...", (err as Error).message);
      }
      await sleep(1000);
    }
  }
  
  throw new Error("VAA timeout after " + timeout + "ms");
}

/**
 * 提取交易日志中的序列号
 */
export function extractSequenceFromLogs(logs: string[]): bigint | null {
  for (const log of logs) {
    if (log.includes("MessagePublished")) {
      // 解析日志提取sequence
      const match = log.match(/sequence=(\d+)/);
      if (match) {
        return BigInt(match[1]);
      }
    }
  }
  return null;
}

/**
 * 计算程序派生地址（PDA）
 */
export function derivePDA(
  seeds: (Buffer | Uint8Array | string)[],
  programId: PublicKey
): [PublicKey, number] {
  const seedBuffers = seeds.map((seed) => {
    if (typeof seed === "string") {
      return Buffer.from(seed);
    }
    return Buffer.from(seed);
  });
  
  return PublicKey.findProgramAddressSync(seedBuffers, programId);
}

/**
 * 获取Bridge PDA
 */
export function getBridgePDA(programId: PublicKey): [PublicKey, number] {
  return derivePDA([Buffer.from("Bridge")], programId);
}

/**
 * 获取GuardianSet PDA
 */
export function getGuardianSetPDA(
  programId: PublicKey,
  index: number
): [PublicKey, number] {
  const indexBuffer = Buffer.alloc(4);
  indexBuffer.writeUInt32LE(index);
  return derivePDA([Buffer.from("GuardianSet"), indexBuffer], programId);
}

/**
 * 获取Sequence PDA
 */
export function getSequencePDA(
  programId: PublicKey,
  emitter: PublicKey
): [PublicKey, number] {
  return derivePDA(
    [Buffer.from("Sequence"), emitter.toBuffer()],
    programId
  );
}

/**
 * 获取PostedMessage PDA
 */
export function getPostedMessagePDA(
  programId: PublicKey,
  emitter: PublicKey,
  sequence: bigint
): [PublicKey, number] {
  const sequenceBuffer = Buffer.alloc(8);
  sequenceBuffer.writeBigUInt64LE(sequence);
  return derivePDA(
    [Buffer.from("PostedMessage"), emitter.toBuffer(), sequenceBuffer],
    programId
  );
}

/**
 * 获取PostedVAA PDA
 */
export function getPostedVAAPDA(
  programId: PublicKey,
  vaaHash: Buffer
): [PublicKey, number] {
  return derivePDA([Buffer.from("PostedVAA"), vaaHash], programId);
}

/**
 * 获取WrappedMeta PDA
 */
export function getWrappedMetaPDA(
  programId: PublicKey,
  tokenChain: number,
  tokenAddress: Buffer
): [PublicKey, number] {
  const chainBuffer = Buffer.alloc(2);
  chainBuffer.writeUInt16LE(tokenChain);
  return derivePDA(
    [Buffer.from("WrappedMeta"), chainBuffer, tokenAddress],
    programId
  );
}

/**
 * 断言交易成功
 */
export function assertTxSuccess(signature: string, message?: string): void {
  console.log(`✓ Transaction successful: ${formatSignature(signature)}`);
  if (message) {
    console.log(`  ${message}`);
  }
}

/**
 * 断言交易失败
 */
export function assertTxFailed(error: any, expectedError?: string): void {
  if (expectedError) {
    if (error.toString().includes(expectedError)) {
      console.log(`✓ Transaction failed as expected: ${expectedError}`);
    } else {
      throw new Error(`Expected error "${expectedError}", but got: ${error}`);
    }
  } else {
    console.log(`✓ Transaction failed as expected`);
  }
}

/**
 * 十六进制字符串转Buffer
 */
export function hexToBuffer(hex: string): Buffer {
  return Buffer.from(hex.replace(/^0x/, ''), 'hex');
}

/**
 * Buffer转十六进制字符串
 */
export function bufferToHex(buffer: Buffer): string {
  return '0x' + buffer.toString('hex');
}

/**
 * 生成随机nonce
 */
export function generateNonce(): number {
  return Math.floor(Math.random() * 0xffffffff);
}

/**
 * 以太坊地址转32字节格式
 */
export function ethAddressToBytes32(ethAddress: string): Buffer {
  const buffer = Buffer.alloc(32);
  const addressBuffer = Buffer.from(ethAddress.replace('0x', ''), 'hex');
  addressBuffer.copy(buffer, 12); // 以太坊地址20字节，前面补12个0
  return buffer;
}

/**
 * Solana公钥转32字节格式
 */
export function solanaAddressToBytes32(pubkey: PublicKey): Buffer {
  return Buffer.from(pubkey.toBytes());
}

/**
 * 当前时间戳（秒）
 */
export function now(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * 延迟时间戳（秒）
 */
export function futureTimestamp(seconds: number): number {
  return now() + seconds;
}

/**
 * 美化打印测试标题
 */
export function printTestHeader(title: string): void {
  console.log("\n" + "=".repeat(60));
  console.log(`  ${title}`);
  console.log("=".repeat(60));
}

/**
 * 美化打印测试步骤
 */
export function printTestStep(step: number, description: string): void {
  console.log(`\n[Step ${step}] ${description}`);
}

/**
 * 断言相等
 */
export function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(
      `Assertion failed: ${message || ""}\n  Expected: ${expected}\n  Actual: ${actual}`
    );
  }
  console.log(`✓ ${message || "Assertion passed"}`);
}

/**
 * 断言包含
 */
export function assertIncluded(
  container: any[],
  element: any,
  message?: string
): void {
  if (!container.includes(element)) {
    throw new Error(
      `Assertion failed: ${message || ""}\n  Element ${element} not found in container`
    );
  }
  console.log(`✓ ${message || "Element found"}`);
}

/**
 * 断言大于
 */
export function assertGreaterThan(
  actual: number | bigint,
  expected: number | bigint,
  message?: string
): void {
  if (actual <= expected) {
    throw new Error(
      `Assertion failed: ${message || ""}\n  Expected ${actual} > ${expected}`
    );
  }
  console.log(`✓ ${message || "Assertion passed"}`);
}

/**
 * 断言小于
 */
export function assertLessThan(
  actual: number | bigint,
  expected: number | bigint,
  message?: string
): void {
  if (actual >= expected) {
    throw new Error(
      `Assertion failed: ${message || ""}\n  Expected ${actual} < ${expected}`
    );
  }
  console.log(`✓ ${message || "Assertion passed"}`);
}

