# Relayer SDK 测试套件

## 测试结构

```
test/
├── unit/                    # 单元测试（10个）
│   ├── config.test.ts      # 配置验证测试
│   ├── vaa.test.ts         # VAA解析测试
│   ├── events.test.ts      # 事件解析测试
│   └── utils.test.ts       # 工具函数测试
│
├── integration/             # 集成测试（9个）
│   ├── guardian.test.ts    # Guardian API集成
│   ├── evm.test.ts         # EVM合约集成
│   └── solana.test.ts      # Solana程序集成
│
├── e2e/                     # 端到端测试（5个）
│   └── cross-chain.test.ts # 完整跨链流程
│
├── utils/                   # 测试工具
│   ├── vaa.ts              # VAA生成工具
│   └── mocks.ts            # Mock对象
│
├── config.ts               # 测试配置
├── setup.ts                # Jest设置
└── README.md               # 本文档
```

## 测试覆盖

| 测试类型 | 用例数 | 覆盖率目标 | 说明 |
|---------|-------|-----------|------|
| 单元测试 | 10个 | 90%代码 | 纯函数测试，无外部依赖 |
| 集成测试 | 9个 | 80%集成点 | Mock外部API和合约 |
| 端到端测试 | 5个 | 100%关键流程 | 完整跨链流程模拟 |
| **总计** | **24个** | - | - |

## 运行测试

### 安装依赖

```bash
npm install
# 或
yarn install
```

### 运行所有测试

```bash
npm test
```

### 运行单元测试

```bash
npm run test:unit
```

输出示例：
```
PASS test/unit/config.test.ts
  RelayerSDK Configuration
    ✓ should accept valid configuration (5ms)
    ✓ should throw error for missing guardian URL (3ms)
    ✓ should throw error for invalid private key (2ms)

PASS test/unit/vaa.test.ts
  parseVAA
    ✓ should parse valid VAA (8ms)
    ✓ should throw error for invalid VAA (2ms)
    ✓ should validate signature count (5ms)

PASS test/unit/events.test.ts
  parseLogMessagePublished
    ✓ should parse LogMessagePublished event (4ms)
    ✓ should return null when event not found (1ms)

PASS test/unit/utils.test.ts
  addressConversion
    ✓ should convert EVM address to 32 bytes (3ms)
    ✓ should convert Solana address to 32 bytes (4ms)
  chainTypeDetection
    ✓ should detect EVM chain (2ms)
    ✓ should detect Solana chain (1ms)
    ✓ should throw for unknown chain (2ms)

Test Suites: 4 passed, 4 total
Tests:       13 passed, 13 total
```

### 运行集成测试

```bash
npm run test:integration
```

**注意**: 集成测试使用 Mock 对象模拟外部服务，不需要真实的网络连接。

### 运行端到端测试

```bash
npm run test:e2e
```

### 生成覆盖率报告

```bash
npm run test:coverage
```

查看覆盖率报告：
```bash
open coverage/lcov-report/index.html
```

## 测试用例说明

### 单元测试

#### TEST-SDK-001 ~ 003: 配置验证
- 验证SDK初始化参数
- 检查必填字段
- 验证私钥格式

#### TEST-SDK-004 ~ 006: VAA解析
- 解析有效的VAA字节数组
- 处理无效格式
- 验证签名数量

#### TEST-SDK-007 ~ 008: 事件解析
- 从交易收据中提取LogMessagePublished事件
- 处理事件不存在的情况

#### TEST-SDK-009 ~ 010: 工具函数
- 地址格式转换（EVM ↔ 32字节）
- 链类型判断（EVM vs Solana）

### 集成测试

#### TEST-SDK-INT-001 ~ 004: Guardian API
- 获取已就绪的VAA
- 轮询聚合中的VAA
- 处理404错误
- 超时处理

#### TEST-SDK-INT-005 ~ 007: EVM合约
- 提交VAA到测试网
- 检测已消费的VAA
- Gas成本估算

#### TEST-SDK-INT-008 ~ 009: Solana程序
- 提交VAA到Solana devnet
- 查询账户余额

### 端到端测试

#### TEST-SDK-E2E-001 ~ 002: 完整跨链流程
- Solana → Ethereum 代币转账
- Ethereum → Solana 代币转账

#### TEST-SDK-E2E-003: 错误恢复
- 重试失败的提交

#### TEST-SDK-E2E-004: 并发处理
- 批量处理多个VAA

#### TEST-SDK-E2E-005: 余额监控
- 余额不足告警

## Mock实现说明

### VAA生成（test/utils/vaa.ts）

使用真实的密码学算法生成VAA：

1. **Guardian密钥生成**: 使用secp256k1生成密钥对
2. **签名**: ECDSA签名，与Ethereum兼容
3. **哈希**: Keccak256双重哈希
4. **序列化**: 完全遵循Wormhole VAA格式

```typescript
// 生成19个Guardian密钥
const guardianKeys = generateGuardianKeys(19);

// 创建Token Transfer VAA
const vaa = createTestVAA({
  guardianSetIndex: 0,
  emitterChain: 2,
  emitterAddress: Buffer.alloc(32, 0x11),
  sequence: 42n,
  payload: tokenTransferPayload,
  guardianKeys,
  signerCount: 13, // 13/19门限
});
```

### Guardian API Mock（test/integration/guardian.test.ts）

使用 `nock` 库模拟HTTP响应：

```typescript
nock('https://guardian.bridge.io')
  .get('/v1/signed_vaa/2/0x.../42')
  .reply(200, {
    vaaBytes: '0x...',
  });
```

### 合约Mock（test/integration/evm.test.ts）

模拟合约调用：
- 跟踪已提交的VAA（防重放）
- 模拟交易确认
- Gas估算

## 环境配置

创建 `.env.test` 文件：

```bash
# Guardian API
GUARDIAN_URL=https://guardian-testnet.bridge.io

# Sepolia testnet
SEPOLIA_RPC_URL=https://rpc.sepolia.org
TEST_PRIVATE_KEY=0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d

# Solana devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_BRIDGE_PROGRAM=Bridge1p5gheXUvJ6jGWGeCsgPKgnE3YgdGKRVCMY9o
```

**注意**: 测试使用Mock对象，不需要真实的API密钥。

## CI/CD集成

GitHub Actions配置示例（`.github/workflows/test.yml`）：

```yaml
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
      
  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run test:e2e
```

## 故障排查

### 测试失败常见原因

1. **依赖未安装**
   ```bash
   npm install
   ```

2. **TypeScript编译错误**
   ```bash
   npm run build
   ```

3. **Jest配置问题**
   - 检查 `jest.config.js`
   - 确认 `ts-jest` 已安装

4. **Mock未清理**
   - 检查 `afterEach(() => nock.cleanAll())`

### 查看详细日志

```bash
npm test -- --verbose
```

### 调试单个测试

```bash
npm test -- --testNamePattern="should parse valid VAA"
```

## 贡献指南

### 添加新测试

1. 在相应目录创建测试文件
2. 遵循现有命名规范：`*.test.ts`
3. 使用描述性测试名称
4. 添加必要的注释

### 测试规范

- ✅ 每个测试应该独立运行
- ✅ 使用Mock对象隔离外部依赖
- ✅ 测试名称清晰描述测试内容
- ✅ 断言具体且有意义
- ❌ 不要使用真实的API密钥
- ❌ 不要依赖网络连接
- ❌ 不要使用硬编码的时间延迟

## 参考资料

- [TEST-PLAN.md](../docs/TEST-PLAN.md) - 完整测试规划
- [API-SPEC.md](../docs/API-SPEC.md) - API规格说明
- [Jest文档](https://jestjs.io/)
- [Nock文档](https://github.com/nock/nock)

