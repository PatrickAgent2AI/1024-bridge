# Relayer SDK - API规格说明书

> **文档版本**: v2.0  
> **创建日期**: 2025-11-09  
> **更新日期**: 2025-11-09  
> **所属项目**: 跨链桥 Relayer SDK  
> **更新说明**: 重新定位为TypeScript SDK，提供VAA获取和提交功能

---

## 📋 目录

1. [SDK概述](#1-sdk概述)
2. [安装和配置](#2-安装和配置)
3. [核心API](#3-核心api)
4. [类型定义](#4-类型定义)
5. [错误处理](#5-错误处理)
6. [使用示例](#6-使用示例)

---

## 1. SDK概述

### 1.1 SDK定位

**Relayer SDK**是一个轻量级的TypeScript库，用于简化跨链桥的VAA中继流程。

**核心功能**:
1. 从Guardian API获取已签名的VAA
2. 提交VAA到目标链合约（EVM或Solana）

**不包含**:
- ❌ 后台服务
- ❌ 任务队列
- ❌ 数据库
- ❌ REST API
- ❌ 手续费机制

---

### 1.2 使用场景

```typescript
// 典型用户流程

// 1. 用户在前端发起跨链转账
const tx = await sourceChainContract.lockTokens(...);

// 2. 获取消息ID
const { emitterAddress, sequence } = parseLogFromTx(tx);

// 3. 使用SDK获取VAA
const relayer = new RelayerSDK(config);
const vaa = await relayer.fetchVAA(sourceChainId, emitterAddress, sequence);

// 4. 使用SDK提交到目标链
const txHash = await relayer.submitVAA(targetChainId, vaa);

// 5. 等待确认
await relayer.waitForConfirmation(targetChainId, txHash);
```

---

## 2. 安装和配置

### 2.1 安装

```bash
npm install @bridge/relayer-sdk
# 或
yarn add @bridge/relayer-sdk
```

---

### 2.2 配置

```typescript
import { RelayerSDK, RelayerConfig } from '@bridge/relayer-sdk';

const config: RelayerConfig = {
  // Guardian配置
  guardian: {
    url: 'https://guardian.bridge.io',
    timeout: 300000, // 5分钟
    retryInterval: 5000, // 5秒轮询间隔
  },
  
  // EVM链配置
  evm: {
    ethereum: {
      chainId: 1,
      rpcUrl: 'https://eth.llamarpc.com',
      coreContract: '0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B',
      privateKey: process.env.ETH_PRIVATE_KEY!,
    },
    bsc: {
      chainId: 56,
      rpcUrl: 'https://bsc-dataseed.binance.org',
      coreContract: '0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B',
      privateKey: process.env.BSC_PRIVATE_KEY!,
    },
  },
  
  // Solana链配置
  solana: {
    chainId: 2,
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    bridgeProgram: 'worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth',
    payerKeypair: Keypair.fromSecretKey(
      Buffer.from(process.env.SOLANA_PRIVATE_KEY!, 'hex')
    ),
  },
};

const relayer = new RelayerSDK(config);
```

---

## 3. 核心API

### 3.1 RelayerSDK类

#### 3.1.1 构造函数

```typescript
constructor(config: RelayerConfig)
```

**参数**:
- `config`: RelayerConfig - SDK配置对象

**示例**:
```typescript
const relayer = new RelayerSDK({
  guardian: { url: 'https://guardian.bridge.io' },
  evm: { /* ... */ },
  solana: { /* ... */ },
});
```

---

#### 3.1.2 fetchVAA

```typescript
async fetchVAA(
  sourceChainId: number,
  emitterAddress: string,
  sequence: number,
  options?: FetchVAAOptions
): Promise<Uint8Array>
```

**功能**: 从Guardian获取已签名的VAA

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sourceChainId` | number | 是 | 源链ID（1=Ethereum, 2=Solana） |
| `emitterAddress` | string | 是 | 发送者地址（32字节十六进制） |
| `sequence` | number | 是 | 消息序列号 |
| `options` | FetchVAAOptions | 否 | 可选配置 |

**返回**: `Promise<Uint8Array>` - VAA字节数组

**行为**:
1. 调用Guardian API: `GET /v1/signed_vaa/{chain}/{emitter}/{sequence}`
2. 如果返回200：VAA已就绪，直接返回
3. 如果返回202：VAA聚合中，等待`retryInterval`后重试
4. 如果返回404：VAA不存在，抛出错误
5. 重试直到超时（默认5分钟）

**示例**:
```typescript
try {
  const vaa = await relayer.fetchVAA(
    2, // Solana
    '0x' + '11'.repeat(32), // emitter address
    42 // sequence
  );
  console.log('VAA fetched:', Buffer.from(vaa).toString('hex'));
} catch (error) {
  if (error instanceof VAANotFoundError) {
    console.error('VAA not found');
  } else if (error instanceof VAATimeoutError) {
    console.error('VAA aggregation timeout');
  }
}
```

**FetchVAAOptions**:
```typescript
interface FetchVAAOptions {
  timeout?: number;        // 超时时间（毫秒），默认300000（5分钟）
  retryInterval?: number;  // 重试间隔（毫秒），默认5000（5秒）
  onProgress?: (status: VAAStatus) => void; // 进度回调
}
```

**进度回调示例**:
```typescript
const vaa = await relayer.fetchVAA(2, emitter, sequence, {
  onProgress: (status) => {
    console.log(`VAA status: ${status.status}`);
    console.log(`Signatures: ${status.signatureCount}/${status.requiredSignatures}`);
  }
});
```

---

#### 3.1.3 submitVAA

```typescript
async submitVAA(
  targetChainId: number,
  vaa: Uint8Array,
  options?: SubmitVAAOptions
): Promise<string>
```

**功能**: 提交VAA到目标链合约

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `targetChainId` | number | 是 | 目标链ID |
| `vaa` | Uint8Array | 是 | VAA字节数组 |
| `options` | SubmitVAAOptions | 否 | 可选配置 |

**返回**: `Promise<string>` - 交易哈希

**行为**:
1. 根据`targetChainId`判断链类型（EVM或Solana）
2. EVM链：调用`BridgeCore.receiveMessage(vaa)`
3. Solana链：调用`solana_core.post_vaa(vaa)`
4. 返回交易哈希

**示例**:
```typescript
// 提交到EVM链
const txHash = await relayer.submitVAA(1, vaa, {
  gasLimit: 200000,
  gasPrice: 'fast',
});
console.log('Transaction hash:', txHash);

// 提交到Solana
const signature = await relayer.submitVAA(2, vaa, {
  priorityFee: 5000, // micro-lamports
});
console.log('Transaction signature:', signature);
```

**SubmitVAAOptions**:
```typescript
interface SubmitVAAOptions {
  // EVM选项
  gasLimit?: number;     // Gas限额，默认自动估算
  gasPrice?: number | 'slow' | 'normal' | 'fast'; // Gas价格
  maxFeePerGas?: number;
  maxPriorityFeePerGas?: number;
  
  // Solana选项
  priorityFee?: number;  // 优先费用（micro-lamports）
  
  // 通用选项
  dryRun?: boolean;      // 模拟运行，不实际提交
}
```

---

#### 3.1.4 waitForConfirmation

```typescript
async waitForConfirmation(
  chainId: number,
  txHash: string,
  confirmations?: number
): Promise<TransactionReceipt>
```

**功能**: 等待交易确认

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `chainId` | number | 是 | 链ID |
| `txHash` | string | 是 | 交易哈希 |
| `confirmations` | number | 否 | 确认块数，默认链配置值 |

**返回**: `Promise<TransactionReceipt>` - 交易收据

**示例**:
```typescript
const receipt = await relayer.waitForConfirmation(1, txHash, 12);
console.log('Transaction confirmed:', receipt.status === 1 ? 'success' : 'failed');
console.log('Gas used:', receipt.gasUsed);
```

---

#### 3.1.5 getBalance

```typescript
async getBalance(chainId: number): Promise<string>
```

**功能**: 查询Relayer账户余额

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `chainId` | number | 是 | 链ID |

**返回**: `Promise<string>` - 余额（ETH或SOL）

**示例**:
```typescript
const ethBalance = await relayer.getBalance(1);
console.log(`Ethereum balance: ${ethBalance} ETH`);

const solBalance = await relayer.getBalance(2);
console.log(`Solana balance: ${solBalance} SOL`);
```

---

### 3.2 工具函数

#### 3.2.1 parseVAA

```typescript
function parseVAA(vaa: Uint8Array): ParsedVAA
```

**功能**: 解析VAA字节数组

**参数**:
- `vaa`: Uint8Array - VAA字节数组

**返回**: `ParsedVAA` - 解析后的VAA结构

**示例**:
```typescript
import { parseVAA } from '@bridge/relayer-sdk';

const parsed = parseVAA(vaa);
console.log('Source chain:', parsed.emitterChain);
console.log('Sequence:', parsed.sequence);
console.log('Signatures:', parsed.signatures.length);
console.log('Payload:', Buffer.from(parsed.payload).toString('hex'));
```

---

#### 3.2.2 parseLogMessagePublished

```typescript
function parseLogMessagePublished(
  receipt: TransactionReceipt
): MessagePublishedEvent | null
```

**功能**: 从交易收据中解析LogMessagePublished事件

**参数**:
- `receipt`: TransactionReceipt - 交易收据

**返回**: `MessagePublishedEvent | null` - 解析的事件或null

**示例**:
```typescript
import { parseLogMessagePublished } from '@bridge/relayer-sdk';

// 用户发起跨链转账
const tx = await tokenVault.lockTokens(...);
const receipt = await tx.wait();

// 解析事件
const event = parseLogMessagePublished(receipt);
if (event) {
  console.log('Emitter:', event.sender);
  console.log('Sequence:', event.sequence);
  
  // 用于获取VAA
  const vaa = await relayer.fetchVAA(
    sourceChainId,
    event.sender,
    event.sequence
  );
}
```

---

#### 3.2.3 estimateGasCost

```typescript
async function estimateGasCost(
  chainId: number,
  vaa: Uint8Array
): Promise<GasCostEstimate>
```

**功能**: 估算提交VAA的Gas成本

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `chainId` | number | 是 | 目标链ID |
| `vaa` | Uint8Array | 是 | VAA字节数组 |

**返回**: `Promise<GasCostEstimate>` - Gas成本估算

**示例**:
```typescript
import { estimateGasCost } from '@bridge/relayer-sdk';

const estimate = await estimateGasCost(1, vaa);
console.log(`Estimated gas: ${estimate.gasLimit}`);
console.log(`Estimated cost: ${estimate.costInEth} ETH`);
console.log(`Estimated cost: $${estimate.costInUsd} USD`);
```

---

## 4. 类型定义

### 4.1 RelayerConfig

```typescript
interface RelayerConfig {
  guardian: GuardianConfig;
  evm?: Record<string, EVMChainConfig>;
  solana?: SolanaConfig;
}

interface GuardianConfig {
  url: string;           // Guardian API URL
  timeout?: number;      // 超时时间（毫秒），默认300000
  retryInterval?: number; // 轮询间隔（毫秒），默认5000
}

interface EVMChainConfig {
  chainId: number;
  rpcUrl: string;
  coreContract: string;  // BridgeCore合约地址
  privateKey: string;    // 私钥（带0x前缀）
  confirmations?: number; // 确认块数，默认12
}

interface SolanaConfig {
  chainId: number;
  rpcUrl: string;
  bridgeProgram: string; // Bridge程序地址
  payerKeypair: Keypair; // 付款人密钥对
  commitment?: Commitment; // 确认级别，默认'finalized'
}
```

---

### 4.2 ParsedVAA

```typescript
interface ParsedVAA {
  version: number;
  guardianSetIndex: number;
  signatures: Signature[];
  timestamp: number;
  nonce: number;
  emitterChain: number;
  emitterAddress: Uint8Array;
  sequence: number;
  consistencyLevel: number;
  payload: Uint8Array;
}

interface Signature {
  guardianIndex: number;
  signature: Uint8Array; // 65字节 (r, s, v)
}
```

---

### 4.3 VAAStatus

```typescript
interface VAAStatus {
  messageId: string;
  status: 'pending' | 'aggregating' | 'ready' | 'consumed';
  signatureCount: number;
  requiredSignatures: number;
  progress: number; // 0-1
  guardiansSigned: number[];
}
```

---

### 4.4 MessagePublishedEvent

```typescript
interface MessagePublishedEvent {
  sender: string;        // 发送者地址
  sequence: number;      // 序列号
  nonce: number;
  payload: Uint8Array;
  consistencyLevel: number;
}
```

---

### 4.5 TransactionReceipt

```typescript
interface TransactionReceipt {
  transactionHash: string;
  blockNumber: number;
  blockHash: string;
  status: number; // 1=success, 0=failed
  gasUsed: number;
  effectiveGasPrice?: number;
}
```

---

### 4.6 GasCostEstimate

```typescript
interface GasCostEstimate {
  gasLimit: number;
  gasPrice: number;
  costInEth: string;
  costInUsd: string;
  timestamp: number;
}
```

---

## 5. 错误处理

### 5.1 错误类型

```typescript
// VAA未找到
class VAANotFoundError extends Error {
  constructor(
    public chainId: number,
    public emitter: string,
    public sequence: number
  );
}

// VAA超时
class VAATimeoutError extends Error {
  constructor(
    public chainId: number,
    public emitter: string,
    public sequence: number,
    public timeout: number
  );
}

// VAA已被消费
class VAAAlreadyConsumedError extends Error {
  constructor(public vaaHash: string);
}

// 链配置未找到
class ChainNotConfiguredError extends Error {
  constructor(public chainId: number);
}

// 余额不足
class InsufficientBalanceError extends Error {
  constructor(
    public chainId: number,
    public required: string,
    public available: string
  );
}

// 交易失败
class TransactionFailedError extends Error {
  constructor(
    public txHash: string,
    public reason: string
  );
}

// Guardian API错误
class GuardianAPIError extends Error {
  constructor(
    public statusCode: number,
    public message: string
  );
}
```

---

### 5.2 错误处理示例

```typescript
import {
  VAANotFoundError,
  VAATimeoutError,
  VAAAlreadyConsumedError,
  InsufficientBalanceError,
  TransactionFailedError,
} from '@bridge/relayer-sdk';

async function relayVAA() {
  try {
    // 1. 获取VAA
    const vaa = await relayer.fetchVAA(sourceChainId, emitter, sequence);
    
    // 2. 检查余额
    const balance = await relayer.getBalance(targetChainId);
    console.log(`Balance: ${balance} ETH`);
    
    // 3. 提交VAA
    const txHash = await relayer.submitVAA(targetChainId, vaa);
    console.log(`Transaction submitted: ${txHash}`);
    
    // 4. 等待确认
    const receipt = await relayer.waitForConfirmation(targetChainId, txHash);
    console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
    
  } catch (error) {
    if (error instanceof VAANotFoundError) {
      console.error('VAA not found on Guardian');
    } else if (error instanceof VAATimeoutError) {
      console.error('VAA aggregation timeout, please retry later');
    } else if (error instanceof VAAAlreadyConsumedError) {
      console.log('VAA already consumed, transfer completed');
    } else if (error instanceof InsufficientBalanceError) {
      console.error(`Insufficient balance: need ${error.required}, have ${error.available}`);
    } else if (error instanceof TransactionFailedError) {
      console.error(`Transaction failed: ${error.reason}`);
    } else {
      console.error('Unknown error:', error);
    }
  }
}
```

---

## 6. 使用示例

### 6.1 完整的跨链流程

```typescript
import { RelayerSDK, parseLogMessagePublished } from '@bridge/relayer-sdk';
import { ethers } from 'ethers';

async function crossChainTransfer() {
  // 1. 初始化SDK
  const relayer = new RelayerSDK({
    guardian: { url: 'https://guardian.bridge.io' },
    evm: {
      ethereum: {
        chainId: 1,
        rpcUrl: process.env.ETH_RPC_URL!,
        coreContract: '0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B',
        privateKey: process.env.ETH_PRIVATE_KEY!,
      }
    },
    solana: {
      chainId: 2,
      rpcUrl: process.env.SOLANA_RPC_URL!,
      bridgeProgram: 'worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth',
      payerKeypair: Keypair.fromSecretKey(...),
    }
  });

  // 2. 用户在Solana锁定代币
  const provider = new ethers.providers.JsonRpcProvider(process.env.SOLANA_RPC_URL);
  // ... 用户操作，获取交易收据
  const solanaTx = await tokenBridge.transferTokens(...);
  
  // 3. 解析事件获取消息ID
  const event = parseLogMessagePublished(solanaTx);
  if (!event) {
    throw new Error('No LogMessagePublished event found');
  }
  
  console.log(`Message published: emitter=${event.sender}, sequence=${event.sequence}`);
  
  // 4. 从Guardian获取VAA（轮询）
  console.log('Waiting for VAA...');
  const vaa = await relayer.fetchVAA(
    2, // Solana
    event.sender,
    event.sequence,
    {
      onProgress: (status) => {
        console.log(`VAA progress: ${(status.progress * 100).toFixed(1)}%`);
        console.log(`Signatures: ${status.signatureCount}/${status.requiredSignatures}`);
      }
    }
  );
  
  console.log('VAA fetched successfully');
  
  // 5. 提交到Ethereum
  console.log('Submitting VAA to Ethereum...');
  const txHash = await relayer.submitVAA(1, vaa, {
    gasPrice: 'fast',
  });
  
  console.log(`Transaction submitted: ${txHash}`);
  
  // 6. 等待确认
  const receipt = await relayer.waitForConfirmation(1, txHash, 12);
  
  if (receipt.status === 1) {
    console.log('✅ Cross-chain transfer completed!');
    console.log(`Gas used: ${receipt.gasUsed}`);
  } else {
    console.error('❌ Transaction failed');
  }
}

crossChainTransfer().catch(console.error);
```

---

### 6.2 批量处理多个VAA

```typescript
async function batchRelay(vaaTasks: VAATask[]) {
  const relayer = new RelayerSDK(config);
  
  const results = await Promise.allSettled(
    vaaTasks.map(async (task) => {
      try {
        // 获取VAA
        const vaa = await relayer.fetchVAA(
          task.sourceChainId,
          task.emitter,
          task.sequence
        );
        
        // 提交到目标链
        const txHash = await relayer.submitVAA(task.targetChainId, vaa);
        
        // 等待确认
        await relayer.waitForConfirmation(task.targetChainId, txHash);
        
        return { success: true, task, txHash };
      } catch (error) {
        return { success: false, task, error };
      }
    })
  );
  
  // 统计结果
  const succeeded = results.filter(r => r.status === 'fulfilled' && r.value.success);
  const failed = results.filter(r => r.status === 'rejected' || !r.value.success);
  
  console.log(`✅ Succeeded: ${succeeded.length}`);
  console.log(`❌ Failed: ${failed.length}`);
}

interface VAATask {
  sourceChainId: number;
  targetChainId: number;
  emitter: string;
  sequence: number;
}
```

---

### 6.3 监控余额并自动充值

```typescript
async function monitorBalance() {
  const relayer = new RelayerSDK(config);
  const MIN_BALANCE_ETH = '0.1'; // 最小余额0.1 ETH
  
  setInterval(async () => {
    try {
      const balance = await relayer.getBalance(1); // Ethereum
      
      if (parseFloat(balance) < parseFloat(MIN_BALANCE_ETH)) {
        console.warn(`⚠️ Low balance: ${balance} ETH`);
        // 发送告警通知
        await sendAlert(`Relayer balance low: ${balance} ETH`);
      } else {
        console.log(`✅ Balance OK: ${balance} ETH`);
      }
    } catch (error) {
      console.error('Failed to check balance:', error);
    }
  }, 60000); // 每分钟检查一次
}

monitorBalance();
```

---

### 6.4 React前端集成

```tsx
import React, { useState } from 'react';
import { RelayerSDK } from '@bridge/relayer-sdk';

function CrossChainTransferButton({ sourceChainId, emitter, sequence, targetChainId }) {
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [txHash, setTxHash] = useState('');
  
  const relayer = new RelayerSDK({
    guardian: { url: 'https://guardian.bridge.io' },
    // ... 配置
  });
  
  const handleRelay = async () => {
    try {
      setStatus('fetching');
      
      // 获取VAA
      const vaa = await relayer.fetchVAA(
        sourceChainId,
        emitter,
        sequence,
        {
          onProgress: (status) => {
            setProgress(status.progress);
          }
        }
      );
      
      setStatus('submitting');
      
      // 提交VAA
      const hash = await relayer.submitVAA(targetChainId, vaa);
      setTxHash(hash);
      
      setStatus('confirming');
      
      // 等待确认
      await relayer.waitForConfirmation(targetChainId, hash);
      
      setStatus('completed');
    } catch (error) {
      console.error(error);
      setStatus('failed');
    }
  };
  
  return (
    <div>
      <button onClick={handleRelay} disabled={status !== 'idle'}>
        Relay VAA
      </button>
      
      {status === 'fetching' && (
        <p>Fetching VAA... {(progress * 100).toFixed(0)}%</p>
      )}
      
      {status === 'submitting' && <p>Submitting to target chain...</p>}
      
      {status === 'confirming' && (
        <p>Waiting for confirmation... <a href={`https://etherscan.io/tx/${txHash}`}>View TX</a></p>
      )}
      
      {status === 'completed' && <p>✅ Transfer completed!</p>}
      
      {status === 'failed' && <p>❌ Transfer failed</p>}
    </div>
  );
}
```

---

## 附录

### A. 支持的链

| 链名称 | Chain ID | 类型 | Core合约/程序地址 |
|-------|---------|------|------------------|
| Ethereum | 1 | EVM | 0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B |
| Solana | 2 | SVM | worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth |
| BSC | 56 | EVM | 0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B |
| Polygon | 137 | EVM | 0x7A4B5a56256163F07b2C80A7cA55aBE66c4ec4d7 |

---

### B. Gas成本参考

| 链 | 操作 | Gas消耗 | 成本（USD） |
|----|------|---------|-----------|
| Ethereum | receiveMessage | ~150,000 | $3-15 |
| BSC | receiveMessage | ~150,000 | $0.15-0.50 |
| Polygon | receiveMessage | ~150,000 | $0.03-0.10 |
| Solana | post_vaa | ~5,000 CU | $0.001-0.005 |

---

### C. Guardian API端点

完整API文档参考父模块：[Guardian API规格](../../docs/API-SPEC.md#4-guardian-rest-api---对外观测接口)

核心端点：
- `GET /v1/signed_vaa/{chain}/{emitter}/{sequence}` - 获取已签名VAA
- `GET /v1/vaa/status/{chain}/{emitter}/{sequence}` - 查询VAA状态

---

**文档状态**: ✅ v2.0 已完成  
**维护者**: Relayer SDK开发团队  
**下次更新**: 根据开发进度更新
