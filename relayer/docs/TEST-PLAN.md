# Relayer SDK - 测试套件规划

> **文档版本**: v2.0  
> **创建日期**: 2025-11-09  
> **更新日期**: 2025-11-09  
> **所属项目**: 跨链桥 Relayer SDK  
> **更新说明**: 重新定位为TypeScript SDK测试规划

---

## 📋 目录

1. [测试策略](#1-测试策略)
2. [单元测试](#2-单元测试)
3. [集成测试](#3-集成测试)
4. [端到端测试](#4-端到端测试)
5. [测试环境配置](#5-测试环境配置)
6. [测试数据准备](#6-测试数据准备)

---

## 1. 测试策略

### 1.1 测试分层

```
┌──────────────────────────────────────────┐
│  端到端测试 (E2E)                         │  20%
│  - 完整跨链流程                           │
│  - 真实链交互                             │
└──────────────────────────────────────────┘
                 ↓
┌──────────────────────────────────────────┐
│  集成测试                                 │  40%
│  - Guardian API集成                      │
│  - EVM合约集成                            │
│  - Solana程序集成                         │
└──────────────────────────────────────────┘
                 ↓
┌──────────────────────────────────────────┐
│  单元测试                                 │  40%
│  - VAA解析                               │
│  - 配置验证                               │
│  - 工具函数                               │
└──────────────────────────────────────────┘
```

---

### 1.2 测试覆盖目标

| 测试类型 | 覆盖率目标 | 用例数 | 预计时间 |
|---------|-----------|--------|---------|
| **单元测试** | 90%代码 | 25个 | 5分钟 |
| **集成测试** | 80%集成点 | 20个 | 15分钟 |
| **E2E测试** | 100%关键流程 | 5个 | 10分钟 |
| **总计** | - | **50个** | **30分钟** |

---

### 1.3 测试优先级

| 优先级 | 测试内容 | 说明 |
|-------|---------|------|
| **P0** | fetchVAA、submitVAA、完整跨链流程 | 核心功能，必须通过 |
| **P1** | 错误处理、余额查询、工具函数 | 重要功能 |
| **P2** | 进度回调、Gas估算 | 辅助功能 |

---

## 2. 单元测试

### 2.1 配置验证测试

#### TEST-SDK-001: 有效配置

```typescript
describe('RelayerSDK Configuration', () => {
  test('should accept valid configuration', () => {
    const config: RelayerConfig = {
      guardian: { url: 'https://guardian.bridge.io' },
      evm: {
        ethereum: {
          chainId: 1,
          rpcUrl: 'https://eth.llamarpc.com',
          coreContract: '0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B',
          privateKey: '0x' + '11'.repeat(32),
        }
      }
    };
    
    const relayer = new RelayerSDK(config);
    expect(relayer).toBeDefined();
  });
});
```

---

#### TEST-SDK-002: 缺少必填字段

```typescript
test('should throw error for missing guardian URL', () => {
  const config = {
    guardian: { url: '' }, // 空URL
    evm: { /* ... */ }
  };
  
  expect(() => new RelayerSDK(config)).toThrow('Guardian URL is required');
});
```

---

#### TEST-SDK-003: 无效的私钥

```typescript
test('should throw error for invalid private key', () => {
  const config = {
    guardian: { url: 'https://guardian.bridge.io' },
    evm: {
      ethereum: {
        chainId: 1,
        rpcUrl: 'https://eth.llamarpc.com',
        coreContract: '0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B',
        privateKey: 'invalid-key', // 无效私钥
      }
    }
  };
  
  expect(() => new RelayerSDK(config)).toThrow('Invalid private key');
});
```

---

### 2.2 VAA解析测试

#### TEST-SDK-004: 解析有效VAA

```typescript
describe('parseVAA', () => {
  test('should parse valid VAA', () => {
    const vaa = generateTestVAA();
    
    const parsed = parseVAA(vaa);
    
    expect(parsed.version).toBe(1);
    expect(parsed.guardianSetIndex).toBe(0);
    expect(parsed.signatures).toHaveLength(13);
    expect(parsed.emitterChain).toBe(2); // Solana
    expect(parsed.sequence).toBe(42);
  });
});
```

---

#### TEST-SDK-005: 解析无效VAA

```typescript
test('should throw error for invalid VAA', () => {
  const invalidVAA = new Uint8Array([0, 1, 2, 3]);
  
  expect(() => parseVAA(invalidVAA)).toThrow('Invalid VAA format');
});
```

---

#### TEST-SDK-006: 验证签名数量

```typescript
test('should validate signature count', () => {
  const vaa = generateTestVAA({ signatureCount: 12 }); // 少于13个
  
  expect(() => parseVAA(vaa)).toThrow('Insufficient signatures');
});
```

---

### 2.3 事件解析测试

#### TEST-SDK-007: 解析LogMessagePublished事件

```typescript
describe('parseLogMessagePublished', () => {
  test('should parse LogMessagePublished event', () => {
    const receipt = createMockReceipt({
      logs: [
        {
          topics: [
            '0x6eb224fb001ed210e379b335e35efe88672a8ce935d981a6896b27ffdf52a3b2', // LogMessagePublished topic
          ],
          data: '0x...' // event data
        }
      ]
    });
    
    const event = parseLogMessagePublished(receipt);
    
    expect(event).toBeDefined();
    expect(event!.sender).toBe('0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb');
    expect(event!.sequence).toBe(42);
  });
});
```

---

#### TEST-SDK-008: 未找到事件

```typescript
test('should return null when event not found', () => {
  const receipt = createMockReceipt({ logs: [] });
  
  const event = parseLogMessagePublished(receipt);
  
  expect(event).toBeNull();
});
```

---

### 2.4 工具函数测试

#### TEST-SDK-009: 地址格式转换

```typescript
describe('addressConversion', () => {
  test('should convert EVM address to 32 bytes', () => {
    const evmAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb';
    
    const bytes32 = evmAddressToBytes32(evmAddress);
    
    expect(bytes32).toHaveLength(32);
    expect(bytes32.subarray(12)).toEqual(
      Buffer.from(evmAddress.slice(2), 'hex')
    );
  });
  
  test('should convert Solana address to 32 bytes', () => {
    const solanaAddress = '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs';
    
    const bytes32 = solanaAddressToBytes32(solanaAddress);
    
    expect(bytes32).toHaveLength(32);
  });
});
```

---

#### TEST-SDK-010: 链类型判断

```typescript
describe('chainTypeDetection', () => {
  test('should detect EVM chain', () => {
    expect(getChainType(1)).toBe('evm'); // Ethereum
    expect(getChainType(56)).toBe('evm'); // BSC
    expect(getChainType(137)).toBe('evm'); // Polygon
  });
  
  test('should detect Solana chain', () => {
    expect(getChainType(2)).toBe('solana');
  });
  
  test('should throw for unknown chain', () => {
    expect(() => getChainType(999)).toThrow('Unknown chain');
  });
});
```

---

## 3. 集成测试

### 3.1 Guardian API集成

#### TEST-SDK-INT-001: 获取已就绪的VAA

```typescript
describe('fetchVAA - Guardian Integration', () => {
  test('should fetch ready VAA from Guardian', async () => {
    // Mock Guardian返回200
    nock('https://guardian.bridge.io')
      .get('/v1/signed_vaa/2/0x1111111111111111111111111111111111111111111111111111111111111111/42')
      .reply(200, {
        vaaBytes: '0x' + Buffer.from(generateTestVAA()).toString('hex'),
        vaa: { /* ... */ }
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
});
```

---

#### TEST-SDK-INT-002: 轮询聚合中的VAA

```typescript
test('should poll until VAA is ready', async () => {
  // 第1-2次返回202，第3次返回200
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
      retryInterval: 1000, // 1秒轮询
    }
  });
  
  const startTime = Date.now();
  const vaa = await relayer.fetchVAA(2, '0x' + '11'.repeat(32), 42);
  const duration = Date.now() - startTime;
  
  expect(vaa).toBeDefined();
  expect(duration).toBeGreaterThanOrEqual(2000); // 至少轮询了2次
}, 15000);
```

---

#### TEST-SDK-INT-003: VAA不存在

```typescript
test('should throw VAANotFoundError for 404', async () => {
  nock('https://guardian.bridge.io')
    .get('/v1/signed_vaa/2/0x1111111111111111111111111111111111111111111111111111111111111111/99')
    .reply(404, 'VAA not found');
  
  const relayer = new RelayerSDK(testConfig);
  
  await expect(
    relayer.fetchVAA(2, '0x' + '11'.repeat(32), 99)
  ).rejects.toThrow(VAANotFoundError);
});
```

---

#### TEST-SDK-INT-004: 超时处理

```typescript
test('should timeout after configured duration', async () => {
  // 始终返回202
  nock('https://guardian.bridge.io')
    .get('/v1/signed_vaa/2/0x1111111111111111111111111111111111111111111111111111111111111111/42')
    .times(100)
    .reply(202, 'VAA still aggregating');
  
  const relayer = new RelayerSDK({
    ...testConfig,
    guardian: {
      url: 'https://guardian.bridge.io',
      timeout: 5000, // 5秒超时
      retryInterval: 1000,
    }
  });
  
  await expect(
    relayer.fetchVAA(2, '0x' + '11'.repeat(32), 42)
  ).rejects.toThrow(VAATimeoutError);
}, 10000);
```

---

### 3.2 EVM合约集成

#### TEST-SDK-INT-005: 提交VAA到EVM链

```typescript
describe('submitVAA - EVM Integration', () => {
  test('should submit VAA to Ethereum testnet', async () => {
    const relayer = new RelayerSDK({
      guardian: { url: 'https://guardian.bridge.io' },
      evm: {
        ethereum: {
          chainId: 11155111, // Sepolia testnet
          rpcUrl: process.env.SEPOLIA_RPC_URL!,
          coreContract: '0x...',
          privateKey: process.env.TEST_PRIVATE_KEY!,
        }
      }
    });
    
    const vaa = generateTestVAA();
    
    const txHash = await relayer.submitVAA(11155111, vaa);
    
    expect(txHash).toMatch(/^0x[0-9a-f]{64}$/i);
    
    // 等待确认
    const receipt = await relayer.waitForConfirmation(11155111, txHash, 1);
    expect(receipt.status).toBe(1);
  }, 60000);
});
```

---

#### TEST-SDK-INT-006: VAA已被消费

```typescript
test('should throw VAAAlreadyConsumedError for consumed VAA', async () => {
  const relayer = new RelayerSDK(testConfig);
  const vaa = generateTestVAA();
  
  // 第一次提交（成功）
  const txHash1 = await relayer.submitVAA(11155111, vaa);
  await relayer.waitForConfirmation(11155111, txHash1, 1);
  
  // 第二次提交（应该失败）
  await expect(
    relayer.submitVAA(11155111, vaa)
  ).rejects.toThrow(VAAAlreadyConsumedError);
}, 120000);
```

---

#### TEST-SDK-INT-007: Gas估算

```typescript
test('should estimate gas correctly', async () => {
  const relayer = new RelayerSDK(testConfig);
  const vaa = generateTestVAA();
  
  const estimate = await estimateGasCost(11155111, vaa);
  
  expect(estimate.gasLimit).toBeGreaterThan(100000);
  expect(estimate.gasLimit).toBeLessThan(300000);
  expect(parseFloat(estimate.costInEth)).toBeGreaterThan(0);
});
```

---

### 3.3 Solana程序集成

#### TEST-SDK-INT-008: 提交VAA到Solana

```typescript
describe('submitVAA - Solana Integration', () => {
  test('should submit VAA to Solana devnet', async () => {
    const relayer = new RelayerSDK({
      guardian: { url: 'https://guardian.bridge.io' },
      solana: {
        chainId: 2,
        rpcUrl: 'https://api.devnet.solana.com',
        bridgeProgram: 'Bridge1p5gheXUvJ6jGWGeCsgPKgnE3YgdGKRVCMY9o',
        payerKeypair: Keypair.fromSecretKey(
          Buffer.from(process.env.SOLANA_TEST_KEY!, 'hex')
        ),
      }
    });
    
    const vaa = generateTestVAA();
    
    const signature = await relayer.submitVAA(2, vaa);
    
    expect(signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]{87,88}$/); // Base58
    
    // 等待确认
    const receipt = await relayer.waitForConfirmation(2, signature);
    expect(receipt.status).toBe(1);
  }, 60000);
});
```

---

#### TEST-SDK-INT-009: Solana账户余额查询

```typescript
test('should get Solana account balance', async () => {
  const relayer = new RelayerSDK(testConfig);
  
  const balance = await relayer.getBalance(2);
  
  expect(parseFloat(balance)).toBeGreaterThan(0);
});
```

---

## 4. 端到端测试

### 4.1 完整跨链流程

#### TEST-SDK-E2E-001: Solana → Ethereum

```typescript
describe('E2E: Complete Cross-Chain Transfer', () => {
  test('should complete Solana to Ethereum transfer', async () => {
    const relayer = new RelayerSDK(fullConfig);
    
    // 步骤1: 在Solana锁定代币（模拟用户操作）
    const solanaTx = await mockLockTokensOnSolana();
    const event = parseLogMessagePublished(solanaTx);
    
    expect(event).toBeDefined();
    console.log(`Message published: sequence=${event!.sequence}`);
    
    // 步骤2: 从Guardian获取VAA
    console.log('Waiting for VAA...');
    const vaa = await relayer.fetchVAA(
      2, // Solana
      event!.sender,
      event!.sequence,
      {
        onProgress: (status) => {
          console.log(`Progress: ${(status.progress * 100).toFixed(1)}%`);
        }
      }
    );
    
    console.log('VAA fetched');
    
    // 步骤3: 提交到Ethereum
    console.log('Submitting to Ethereum...');
    const txHash = await relayer.submitVAA(1, vaa);
    console.log(`TX: ${txHash}`);
    
    // 步骤4: 等待确认
    const receipt = await relayer.waitForConfirmation(1, txHash, 12);
    
    expect(receipt.status).toBe(1);
    console.log('✅ Transfer completed');
  }, 600000); // 10分钟超时
});
```

---

#### TEST-SDK-E2E-002: Ethereum → Solana

```typescript
test('should complete Ethereum to Solana transfer', async () => {
  const relayer = new RelayerSDK(fullConfig);
  
  // 步骤1: 在Ethereum锁定代币
  const ethTx = await mockLockTokensOnEthereum();
  const event = parseLogMessagePublished(ethTx);
  
  // 步骤2: 获取VAA
  const vaa = await relayer.fetchVAA(1, event!.sender, event!.sequence);
  
  // 步骤3: 提交到Solana
  const signature = await relayer.submitVAA(2, vaa);
  
  // 步骤4: 等待确认
  const receipt = await relayer.waitForConfirmation(2, signature);
  
  expect(receipt.status).toBe(1);
}, 600000);
```

---

### 4.2 错误恢复测试

#### TEST-SDK-E2E-003: 重试失败的提交

```typescript
test('should retry failed submission', async () => {
  const relayer = new RelayerSDK(fullConfig);
  
  const vaa = await relayer.fetchVAA(2, emitter, sequence);
  
  // 第一次提交（模拟Gas不足）
  await expect(
    relayer.submitVAA(1, vaa, { gasLimit: 10000 }) // 故意设置过低
  ).rejects.toThrow();
  
  // 第二次提交（正常Gas）
  const txHash = await relayer.submitVAA(1, vaa, { gasLimit: 200000 });
  const receipt = await relayer.waitForConfirmation(1, txHash, 1);
  
  expect(receipt.status).toBe(1);
}, 300000);
```

---

### 4.3 并发处理测试

#### TEST-SDK-E2E-004: 批量处理多个VAA

```typescript
test('should handle multiple VAAs concurrently', async () => {
  const relayer = new RelayerSDK(fullConfig);
  
  const vaaTasks = [
    { sourceChainId: 2, emitter: emitter1, sequence: 1, targetChainId: 1 },
    { sourceChainId: 2, emitter: emitter1, sequence: 2, targetChainId: 1 },
    { sourceChainId: 2, emitter: emitter1, sequence: 3, targetChainId: 1 },
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
```

---

### 4.4 余额监控测试

#### TEST-SDK-E2E-005: 余额不足告警

```typescript
test('should warn on low balance', async () => {
  const relayer = new RelayerSDK({
    ...fullConfig,
    evm: {
      ethereum: {
        ...fullConfig.evm!.ethereum,
        privateKey: emptyAccountKey, // 余额为0的账户
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
```

---

## 5. 测试环境配置

### 5.1 测试网配置

```typescript
// test/config.ts
export const testConfig: RelayerConfig = {
  guardian: {
    url: process.env.GUARDIAN_URL || 'https://guardian-testnet.bridge.io',
    timeout: 300000,
    retryInterval: 5000,
  },
  
  evm: {
    sepolia: {
      chainId: 11155111,
      rpcUrl: process.env.SEPOLIA_RPC_URL || 'https://rpc.sepolia.org',
      coreContract: '0x...',
      privateKey: process.env.TEST_PRIVATE_KEY!,
      confirmations: 1,
    }
  },
  
  solana: {
    chainId: 2,
    rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
    bridgeProgram: 'Bridge1p5gheXUvJ6jGWGeCsgPKgnE3YgdGKRVCMY9o',
    payerKeypair: Keypair.fromSecretKey(
      Buffer.from(process.env.SOLANA_TEST_KEY!, 'hex')
    ),
    commitment: 'confirmed',
  }
};
```

---

### 5.2 Mock服务

```typescript
// test/mocks/guardian.ts
export function setupGuardianMock() {
  nock('https://guardian-testnet.bridge.io')
    .get(/\/v1\/signed_vaa\/.*/)
    .reply((uri) => {
      const [, , , chain, emitter, sequence] = uri.split('/');
      
      // 模拟VAA聚合过程
      if (Date.now() % 2 === 0) {
        return [202, 'VAA still aggregating'];
      }
      
      return [200, {
        vaaBytes: '0x' + Buffer.from(generateTestVAA()).toString('hex')
      }];
    })
    .persist();
}
```

---

## 6. 测试数据准备

### 6.1 生成测试VAA

```typescript
// test/utils/vaa.ts
export function generateTestVAA(options?: Partial<VAAOptions>): Uint8Array {
  const vaa = {
    version: 1,
    guardianSetIndex: 0,
    signatures: generateSignatures(13),
    timestamp: Math.floor(Date.now() / 1000),
    nonce: 0,
    emitterChain: options?.emitterChain || 2,
    emitterAddress: options?.emitterAddress || Buffer.alloc(32, 0x11),
    sequence: options?.sequence || 42,
    consistencyLevel: 200,
    payload: generateTokenTransferPayload(),
  };
  
  return serializeVAA(vaa);
}

function generateSignatures(count: number): Signature[] {
  return Array.from({ length: count }, (_, i) => ({
    guardianIndex: i,
    signature: Buffer.alloc(65, i), // 模拟签名
  }));
}

function generateTokenTransferPayload(): Buffer {
  // PayloadType = 1 (Token Transfer)
  const payload = Buffer.alloc(133);
  payload[0] = 1;
  payload.writeBigUInt64BE(BigInt(1000_000_000), 1); // amount
  // ... 其他字段
  return payload;
}
```

---

### 6.2 测试账户

```bash
# .env.test
GUARDIAN_URL=https://guardian-testnet.bridge.io

# Sepolia testnet
SEPOLIA_RPC_URL=https://rpc.sepolia.org
TEST_PRIVATE_KEY=0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d

# Solana devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_TEST_KEY=<base58_private_key>
```

---

## 附录

### A. 运行测试

```bash
# 运行所有测试
npm test

# 运行单元测试
npm run test:unit

# 运行集成测试（需要测试网）
npm run test:integration

# 运行E2E测试（需要测试网 + 真实资金）
npm run test:e2e

# 生成覆盖率报告
npm run test:coverage
```

---

### B. CI/CD集成

```yaml
# .github/workflows/test.yml
name: Test

on: [push, pull_request]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: npm ci
      - run: npm run test:unit
  
  integration-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run test:integration
        env:
          SEPOLIA_RPC_URL: ${{ secrets.SEPOLIA_RPC_URL }}
          TEST_PRIVATE_KEY: ${{ secrets.TEST_PRIVATE_KEY }}
```

---

**文档状态**: ✅ v2.0 已完成  
**测试覆盖**: 50个测试用例  
**下次更新**: 根据开发进度更新
