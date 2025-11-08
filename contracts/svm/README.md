# Solana 跨链桥合约子模块

> **版本**: v1.1  
> **最后更新**: 2025-11-08  
> **开发状态**: 设计文档已更新，待实现

---

## 项目概述

本子模块是NewLife跨链桥项目的Solana部分，采用Anchor框架开发。与传统的"包装代币"模式不同，本项目创新性地采用**代币注册绑定机制**，支持灵活的跨链代币兑换。

### 核心设计理念

**1. 代币绑定 vs 代币包装**

传统跨链桥（如Wormhole）采用包装代币模式：
- 首次跨链时创建新的Wrapped Token
- 跨链只能同币种兑换（USDC → wUSDC → USDC）
- 包装代币缺乏流动性，难以集成

本项目采用代币绑定模式：
- 注册绑定到目标链已有的代币（如Solana USDC）
- 支持不同币种间兑换（USDC → USDT, DOGE → BTC）
- 直接集成现有生态，无需额外流动性

**2. 灵活的兑换机制**

```
用户发起跨链:
  Solana: 锁定 1000 USDC
    ↓
  Guardian签名VAA
    ↓
  Relayer提交到Ethereum
    ↓
  Ethereum: 解锁 998 USDT  <-- 不同代币，自定义比率
```

**3. 可扩展的定价系统**

- **当前**: 管理员配置固定兑换比率
- **未来**: 集成外部AMM（Raydium/Orca）实现动态定价

---

## 设计原理

### 架构图

```
┌─────────────────────────────────────────────────────┐
│                  Solana Programs                    │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌──────────────┐          ┌──────────────────┐   │
│  │ solana-core  │          │ token-bridge     │   │
│  │              │          │                  │   │
│  │ • post_msg   │ ◀─────── │ • transfer_tokens│   │
│  │ • post_vaa   │          │ • complete_xfer  │   │
│  │ • guardian   │          │ • register_bind  │   │
│  │   upgrade    │          │ • set_rate       │   │
│  └──────────────┘          │ • update_amm     │   │
│                            └──────────────────┘   │
│                                                     │
└─────────────────────────────────────────────────────┘
           ↑                            ↓
           │ Guardian签名VAA             │ 锁定SPL代币
           │                            │
    ┌──────┴──────┐            ┌────────┴─────┐
    │  Guardian   │            │    用户      │
    │   Network   │            │    钱包      │
    └─────────────┘            └──────────────┘
```

### 核心数据流

**跨链转账流程**:
```
1. 用户调用 transfer_tokens(1000 USDC, target=Ethereum)
   ├─ 查询TokenBinding: Solana USDC → Ethereum USDT
   ├─ 计算目标数量: 1000 * 998 / 1000 = 998 USDT
   ├─ 锁定1000 USDC到custody
   └─ 发送消息payload (包含兑换信息)

2. Guardian监听Solana交易
   └─ 19个Guardian节点签名VAA

3. Relayer提交VAA到Ethereum
   ├─ 验证13/19签名
   ├─ 验证兑换比率一致性
   └─ 解锁998 USDT到接收者
```

---

## 目录结构

```
contracts/svm/
├── bridge-programs/         # Anchor项目根目录
│   ├── programs/           # Anchor程序代码
│   │   └── solana-core/   # 核心桥接程序
│   │       ├── src/
│   │       │   ├── lib.rs        # 主程序入口
│   │       │   ├── state.rs      # 账户状态定义
│   │       │   └── error.rs      # 错误定义
│   │       └── Cargo.toml
│   │
│   ├── tests/              # TypeScript测试套件
│   │   ├── unit/          # 单元测试
│   │   ├── integration/   # 集成测试
│   │   └── utils/         # 测试工具函数
│   │
│   ├── Anchor.toml        # Anchor配置
│   ├── Cargo.toml         # Rust workspace配置
│   └── package.json       # Node.js依赖
│
└── docs/                  # 项目文档
    ├── API-SPEC.md       # 接口规范 (已更新v1.1)
    ├── TEST-PLAN.md      # 测试计划 (已更新v1.1)
    ├── PROGRESS.md       # 开发进度 (已更新v1.1)
    └── README.md         # 本文档
```

### 各文件（夹）作用

**程序代码**:
- `programs/solana-core/src/lib.rs`: 核心桥接逻辑（initialize, post_message, post_vaa, update_guardian_set）
- `programs/solana-core/src/state.rs`: 账户结构定义（Bridge, GuardianSet, PostedVAA, PostedMessage）
- `programs/solana-core/src/error.rs`: 错误码定义

**测试套件**:
- `tests/unit/`: 单元测试（47个测试用例，覆盖所有指令）
- `tests/integration/`: 集成测试（跨程序调用、Guardian升级）
- `tests/utils/vaa.ts`: VAA构造工具（真实secp256k1签名）

**配置文件**:
- `Anchor.toml`: 程序ID、测试配置、本地验证器设置
- `Cargo.toml`: Rust依赖（anchor-lang, byteorder, hex等）
- `package.json`: TypeScript依赖（@coral-xyz/anchor, @solana/web3.js）

**文档**:
- `docs/API-SPEC.md`: **详细接口文档**，包含所有指令、数据结构、错误码（71KB）
- `docs/TEST-PLAN.md`: **完整测试计划**，包含70个测试用例和测试示例（98KB）
- `docs/PROGRESS.md`: **开发进度追踪**，包含设计变更说明、里程碑、问题跟踪
- `docs/README.md`: 本文档，项目概览和设计理念

---

## 核心功能

### 1. 代币注册绑定

**功能**: 注册源链与目标链代币的映射关系（支持双向和多对多）

```rust
// 方式1：双向对称注册（推荐）
register_bidirectional_binding {
    local_chain: 900,         // Solana
    local_token: sol_usdc,
    remote_chain: 1,          // Ethereum
    remote_token: eth_usdc,
    outbound_rate: (1, 1),    // 出站 1:1
    inbound_rate: (1, 1),     // 入站 1:1
}
// 自动创建：
// ✅ [900, sol_usdc, 1, eth_usdc] - 出站
// ✅ [1, eth_usdc, 900, sol_usdc] - 入站

// 方式2：单向注册（需手动注册两次）
register_token_binding(900, sol_usdc, 1, eth_usdc)  // 出站
register_token_binding(1, eth_usdc, 900, sol_usdc)  // 入站

// 多对多：同一源代币可绑定多个目标代币
register_token_binding(900, sol_usdc, 1, eth_usdc)    // → Ethereum USDC
register_token_binding(900, sol_usdc, 1, eth_usdt)    // → Ethereum USDT  
register_token_binding(900, sol_usdc, 56, bsc_busd)   // → BSC BUSD
register_token_binding(900, sol_usdc, 137, poly_usdc) // → Polygon USDC
```

**权限**: 仅管理员可调用

### 2. 兑换比率配置

**功能**: 设置跨链兑换比率

```rust
// 示例：1 USDC = 0.998 USDT
set_exchange_rate {
    source_chain: 900,  // Solana
    source_token: USDC,
    target_chain: 1,    // Ethereum
    rate_numerator: 998,
    rate_denominator: 1000,
}
```

**计算公式**: `target_amount = source_amount × rate_numerator ÷ rate_denominator`

### 3. 跨链转账（带兑换）

**功能**: 锁定SPL代币并发起跨链兑换

```typescript
// 示例1: USDC → USDC (同币种)
await tokenBridge.methods
  .transferTokens(
    new BN(1000_000_000),   // 1000 USDC
    1,                       // 目标链: Ethereum
    ethUSDCAddress,          // 用户选择目标代币
    ethRecipient
  )
  .rpc();
// → 目标链接收: 1000 USDC

// 示例2: USDC → USDT (不同币种兑换)
await tokenBridge.methods
  .transferTokens(
    new BN(1000_000_000),   // 1000 USDC
    1,                       // 目标链: Ethereum
    ethUSDTAddress,          // 用户选择兑换成USDT
    ethRecipient
  )
  .rpc();
// → 自动计算：1000 USDC × 998/1000 = 998 USDT
```

### 4. 跨链接收（带验证）

**功能**: 验证VAA并解锁目标代币

```rust
complete_transfer {
    vaa: Vec<u8>,  // Guardian签名的VAA
}

// 内部验证：
// 1. VAA签名验证（13/19 Guardian）
// 2. TokenBinding存在性检查
// 3. 兑换比率一致性验证
// 4. 目标代币匹配验证
// 5. custody余额充足检查
```

### 5. AMM集成（预留）

**功能**: 配置外部AMM用于动态定价

```rust
// 启用Raydium AMM
update_amm_config {
    source_chain: 2,
    source_token: USDC,
    target_chain: 1,
    amm_program_id: RaydiumProgramId,
    use_external_price: true,
}

// 转账时自动查询AMM实时价格
```

---

## 技术亮点

### 1. 真实密码学实现

测试套件使用**真实的secp256k1 + ECDSA签名**，而非模拟数据：

```typescript
// 生成19个Guardian密钥对
const guardianKeys = generateGuardianKeys(19);

// ECDSA签名VAA
const signatures = guardianKeys
  .slice(0, 13)
  .map(key => signVAA(bodyHash, key));

// Solana程序验证真实签名
```

### 2. Payload版本兼容

新版Payload（133字节）向后兼容旧版（77字节）：

```rust
if payload.len() == 77 {
    // 旧版本：1:1同币种兑换
    target_token = source_token;
    target_amount = source_amount;
} else if payload.len() == 133 {
    // 新版本：支持兑换信息
    // 解析完整字段
}
```

### 3. 安全验证机制

**兑换比率防篡改**:
```rust
// VAA中的比率必须与链上配置一致
let expected_amount = payload.amount 
    * binding.rate_numerator 
    / binding.rate_denominator;

require!(
    payload.target_amount == expected_amount,
    InvalidExchangeRate
);
```

---

## 开发状态

**当前阶段**: 设计文档已更新（v1.1），待实现

**已完成**:
- ✅ 架构设计（代币绑定机制）
- ✅ API接口规范（71KB详细文档）
- ✅ 测试计划（70个测试用例）
- ✅ 开发进度追踪（含设计变更说明）

**待实现**:
- ⏳ token-bridge程序开发（register_token_binding等3个新指令）
- ⏳ transfer_tokens指令修改（增加TokenBinding验证）
- ⏳ complete_transfer指令修改（增加兑换验证）
- ⏳ 单元测试（47个测试用例）
- ⏳ 集成测试（15个测试场景）

**预计时间**:
- 开发: 2-3天
- 测试: 1-2天
- 总计: **3-5天**

---

## 与其他模块的集成

### Guardian网络
- **依赖**: VAA签名
- **影响**: 无（VAA格式不变）

### Relayer服务
- **依赖**: VAA提交
- **影响**: 无（仍是提交原始VAA）

### EVM合约模块
- **依赖**: 跨链通信
- **影响**: **需同步更新**
  - EVM合约需实现相同的TokenBinding机制
  - 解析新版TokenTransferPayload（133字节）
  - 验证兑换比率一致性

### 测试协调
- **建议**: 先实现并测试Solana → EVM方向
- **原因**: Solana作为源链时，由Solana计算兑换数量
- **顺序**: Solana程序 → EVM合约 → 双向测试

---

## 快速开始

### 环境准备

```bash
# 1. 安装Solana CLI
curl --proto '=https' --tlsv1.2 -sSfL \
  https://solana-install.solana.workers.dev | bash

# 2. 安装Anchor CLI
cargo install --git https://github.com/coral-xyz/anchor anchor-cli --locked

# 3. 进入项目目录
cd contracts/svm/bridge-programs

# 4. 安装依赖
yarn install
```

### 本地测试

```bash
# 启动本地测试验证器（自动）
anchor test

# 或分步执行
anchor build
solana-test-validator &
anchor deploy --provider.cluster localnet
anchor run test
```

### 部署到Devnet

```bash
# 1. 配置Devnet
solana config set --url devnet

# 2. 空投测试SOL
solana airdrop 2

# 3. 部署程序
anchor deploy

# 4. 初始化Bridge
anchor run initialize-devnet
```

---

## 参考文档

**详细文档**:
- [API规格说明书](./docs/API-SPEC.md) - 完整接口定义、数据结构、错误码
- [测试套件规划](./docs/TEST-PLAN.md) - 70个测试用例、测试示例
- [开发进度追踪](./docs/PROGRESS.md) - 设计变更、里程碑、问题跟踪

**外部资源**:
- [Anchor框架文档](https://www.anchor-lang.com/)
- [Solana开发文档](https://docs.solana.com/)
- [Wormhole协议参考](https://docs.wormhole.com/)

---

## 许可证

MIT License

---

**维护者**: Solana合约开发团队  
**最后更新**: 2025-11-08

