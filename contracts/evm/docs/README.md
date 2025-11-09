# EVM合约子模块

> **版本**: v1.0  
> **最后更新**: 2025-11-09  
> **开发状态**: 设计文档已完成，待实现

---

## 项目概述

本子模块是NewLife跨链桥项目的EVM部分，使用Foundry框架开发。与SVM模块保持功能对称，采用创新的**代币绑定机制（TokenBinding）**，支持灵活的跨链代币兑换。

### 核心设计理念

**1. 代币绑定 vs 包装代币**

传统跨链桥采用包装代币模式：
- 首次跨链时创建新的Wrapped Token
- 只能同币种兑换（USDC → wUSDC → USDC）
- 包装代币缺乏流动性

本项目采用代币绑定模式：
- 注册绑定到目标链已有的代币
- 支持不同币种间兑换（USDC → USDT）
- 直接集成现有生态，无需额外流动性

**2. 灵活的兑换机制**

```
用户发起跨链:
  Ethereum: 锁定 1000 USDC
    ↓
  Guardian签名VAA
    ↓
  Relayer提交到Solana
    ↓
  Solana: 解锁 998 USDT  <-- 不同代币，自定义比率
```

**3. 与SVM模块功能对称**

- ✅ 相同的TokenBinding机制
- ✅ 相同的Payload格式（133字节）
- ✅ 相同的兑换验证逻辑
- ✅ 相同的多对多映射支持

---

## 设计原理

### 架构图

```
┌─────────────────────────────────────────────────────┐
│               EVM Smart Contracts                    │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌──────────────┐          ┌──────────────────┐   │
│  │ BridgeCore   │          │ TokenVault       │   │
│  │              │          │                  │   │
│  │ • publishMsg │ ◀─────── │ • lockTokens     │   │
│  │ • receiveMsg │          │ • unlockTokens   │   │
│  │ • verifyVAA  │          │ • registerBind   │   │
│  │ • guardian   │          │ • setRate        │   │
│  │   upgrade    │          │ • queryBinding   │   │
│  └──────────────┘          └──────────────────┘   │
│                                                     │
└─────────────────────────────────────────────────────┘
           ↑                            ↓
           │ Guardian签名VAA             │ 锁定ERC20代币
           │                            │
    ┌──────┴──────┐            ┌────────┴─────┐
    │  Guardian   │            │    用户      │
    │   Network   │            │    钱包      │
    └─────────────┘            └──────────────┘
```

### 核心数据流

**跨链转账流程**:
```
1. 用户调用 lockTokens(1000 USDC, target=Solana, targetToken=USDT)
   ├─ 查询TokenBinding: Ethereum USDC → Solana USDT
   ├─ 计算目标数量: 1000 * 998 / 1000 = 998 USDT
   ├─ 锁定1000 USDC到Vault
   └─ 发送消息payload (包含兑换信息)

2. Guardian监听Ethereum交易
   └─ 19个Guardian节点签名VAA

3. Relayer提交VAA到Solana
   ├─ 验证13/19签名
   ├─ 验证兑换比率一致性
   └─ 解锁998 USDT到接收者
```

---

## 目录结构

```
contracts/evm/
├── src/                      # Solidity合约源码
│   ├── BridgeCore.sol        # 核心桥接合约
│   ├── TokenVault.sol        # 代币金库合约
│   ├── WrappedToken.sol      # 包装代币合约（预留）
│   └── interfaces/           # 接口定义
│
├── test/                     # Foundry测试
│   ├── BridgeCore.t.sol      # BridgeCore测试
│   ├── TokenVault.t.sol      # TokenVault测试
│   ├── integration/          # 集成测试
│   ├── mocks/                # Mock合约
│   └── utils/                # 测试工具函数
│
├── script/                   # 部署脚本
│   ├── Deploy.s.sol          # 主部署脚本
│   └── Initialize.s.sol      # 初始化脚本
│
├── docs/                     # 项目文档
│   ├── API-SPEC.md           # 接口规范 (930行)
│   ├── TEST-PLAN.md          # 测试计划 (80个用例)
│   ├── PROGRESS.md           # 开发进度
│   └── README.md             # 本文档
│
├── foundry.toml              # Foundry配置
├── remappings.txt            # 依赖映射
└── .gitignore                # Git忽略配置
```

### 各文件（夹）作用

**合约代码**:
- `src/BridgeCore.sol`: 核心逻辑（publishMessage, receiveMessage, VAA验证, Guardian管理）
- `src/TokenVault.sol`: 代币管理（lockTokens, unlockTokens, TokenBinding注册, 兑换比率设置）
- `src/WrappedToken.sol`: ERC20包装代币实现（预留，可选使用）
- `src/interfaces/`: 接口定义文件

**测试套件**:
- `test/BridgeCore.t.sol`: BridgeCore单元测试（25个用例）
- `test/TokenVault.t.sol`: TokenVault单元测试（27个用例）
- `test/integration/`: 集成测试（跨合约调用、Guardian升级）
- `test/mocks/`: Mock合约（MockERC20, MockGuardian）

**部署脚本**:
- `script/Deploy.s.sol`: 合约部署脚本
- `script/Initialize.s.sol`: Guardian Set初始化

**文档**:
- `docs/API-SPEC.md`: **详细接口文档**，包含所有函数、数据结构、错误码（930行）
- `docs/TEST-PLAN.md`: **完整测试计划**，包含80个测试用例和测试示例
- `docs/PROGRESS.md`: **开发进度追踪**，包含里程碑、问题跟踪
- `docs/README.md`: 本文档，项目概览和设计理念

---

## 核心功能

### 1. 代币注册绑定

**功能**: 注册源链与目标链代币的映射关系（支持双向和多对多）

```solidity
// 方式1：双向对称注册（推荐）
registerBidirectionalBinding(
    1,              // local_chain: Ethereum
    eth_usdc,       // local_token
    900,            // remote_chain: Solana
    sol_usdc,       // remote_token
    1, 1,           // outbound_rate: 1:1
    1, 1            // inbound_rate: 1:1
);
// 自动创建：
// ✅ [1, eth_usdc, 900, sol_usdc] - 出站
// ✅ [900, sol_usdc, 1, eth_usdc] - 入站

// 方式2：单向注册（需手动注册两次）
registerTokenBinding(1, eth_usdc, 900, sol_usdc);  // 出站
registerTokenBinding(900, sol_usdc, 1, eth_usdc);  // 入站

// 多对多：同一源代币可绑定多个目标代币
registerTokenBinding(1, eth_usdc, 900, sol_usdc);    // → Solana USDC
registerTokenBinding(1, eth_usdc, 900, sol_usdt);    // → Solana USDT  
registerTokenBinding(1, eth_usdc, 56, bsc_busd);     // → BSC BUSD
registerTokenBinding(1, eth_usdc, 137, poly_usdc);   // → Polygon USDC
```

**权限**: 仅治理多签可调用

---

### 2. 兑换比率配置

**功能**: 设置跨链兑换比率

```solidity
// 示例：1 USDC = 0.998 USDT
setExchangeRate(
    1,              // source_chain: Ethereum
    eth_usdc,       // source_token
    900,            // target_chain: Solana
    sol_usdt,       // target_token
    998,            // rate_numerator
    1000            // rate_denominator
);
```

**计算公式**: `target_amount = source_amount × rate_numerator ÷ rate_denominator`

---

### 3. 跨链转账（带兑换）

**功能**: 锁定ERC20代币并发起跨链兑换

```solidity
// 示例1: USDC → USDC (同币种)
vault.lockTokens{value: 0.001 ether}(
    eth_usdc,               // token
    1000e6,                 // amount: 1000 USDC
    900,                    // target_chain: Solana
    sol_usdc,               // target_token: 用户选择
    recipientBytes32
);
// → 目标链接收: 1000 USDC

// 示例2: USDC → USDT (不同币种兑换)
vault.lockTokens{value: 0.001 ether}(
    eth_usdc,               // token
    1000e6,                 // amount: 1000 USDC
    900,                    // target_chain: Solana
    sol_usdt,               // target_token: 用户选择兑换成USDT
    recipientBytes32
);
// → 自动计算：1000 USDC × 998/1000 = 998 USDT
```

---

### 4. 跨链接收（带验证）

**功能**: 验证VAA并解锁目标代币

```solidity
vault.unlockTokens(vaa);

// 内部验证：
// 1. VAA签名验证（13/19 Guardian）
// 2. TokenBinding存在性检查
// 3. 兑换比率一致性验证
// 4. 目标代币匹配验证
// 5. Vault余额充足检查
```

---

## 技术亮点

### 1. 与SVM模块完全对称

**数据结构对称**:
```solidity
// EVM: TokenBinding结构体
struct TokenBinding {
    uint16 sourceChain;
    bytes32 sourceToken;
    uint16 targetChain;
    bytes32 targetToken;
    uint64 rateNumerator;
    uint64 rateDenominator;
    bool enabled;
}

// 对应SVM的TokenBinding (完全一致)
```

**Payload格式对称**:
```solidity
// 新版Payload（133字节）
struct TokenTransferPayload {
    uint8 payloadType;          // 1
    uint256 amount;             // 源链锁定数量
    bytes32 tokenAddress;       // 源链代币地址
    uint16 tokenChain;          // 源链ID
    bytes32 recipient;          // 接收者地址
    uint16 recipientChain;      // 目标链ID
    bytes32 targetToken;        // 目标链代币地址（新增）
    uint64 targetAmount;        // 目标链接收数量（新增）
    uint64 exchangeRateNum;     // 兑换比率分子（新增）
    uint64 exchangeRateDenom;   // 兑换比率分母（新增）
}
```

---

### 2. 标准Payload格式

统一的157字节Payload格式，包含完整的TokenBinding兑换信息：

```solidity
function parsePayload(bytes memory payload) internal pure returns (...) {
    require(payload.length == 157, "Invalid payload length");
    
    // 解析完整字段
    uint8 payloadType = uint8(payload[0]);
    uint256 amount = abi.decode(payload[1:33], (uint256));
    bytes32 tokenAddress = bytes32(payload[33:65]);
    // ... 解析所有字段
}
```

---

### 3. 安全验证机制

**兑换比率防篡改**:
```solidity
// VAA中的比率必须与链上配置一致
TokenBinding memory binding = getTokenBinding(
    payload.tokenChain,
    payload.tokenAddress,
    payload.recipientChain,
    payload.targetToken
);

uint256 expectedAmount = payload.amount 
    * binding.rateNumerator 
    / binding.rateDenominator;

require(
    payload.targetAmount == expectedAmount,
    "InvalidExchangeRate"
);
```

---

## 开发状态

**当前阶段**: 设计文档已完成，待实现

**已完成**:
- ✅ 提取父模块中EVM相关内容
- ✅ 分析SVM模块接口设计
- ✅ 确保EVM与SVM功能对称
- ✅ API接口规范（930行详细文档）
- ✅ 测试计划（80个测试用例）
- ✅ 开发进度追踪文档

**待实现**:
- ⏳ BridgeCore合约开发（publishMessage, receiveMessage, VAA验证）
- ⏳ TokenVault合约开发（lockTokens, unlockTokens, TokenBinding机制）
- ⏳ 单元测试（67个测试用例）
- ⏳ 集成测试（13个测试场景）

**预计时间**:
- 开发: 3-4周
- 测试: 1-2周
- 总计: **4-6周**

---

## 与其他模块的集成

### SVM模块（Solana）
- **依赖**: 跨链通信
- **状态**: ✅ 功能对称设计已完成
- **协调**: 需同步Payload格式和验证逻辑

### Guardian网络
- **依赖**: VAA签名
- **影响**: 无（VAA格式不变）

### Relayer服务
- **依赖**: VAA提交
- **影响**: 无（仍是提交原始VAA）

### 测试协调
- **建议**: 双向测试（EVM ↔ SVM）
- **原因**: 验证兑换机制在两个方向都正常工作
- **顺序**: 单向测试 → 双向测试 → E2E测试

---

## 快速开始

### 环境准备

```bash
# 1. 安装Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup

# 2. 进入项目目录
cd contracts/evm

# 3. 安装依赖
forge install OpenZeppelin/openzeppelin-contracts@v5.0.0
```

### 本地测试

```bash
# 编译合约
forge build

# 运行测试
forge test

# 显示详细日志
forge test -vvv

# 显示Gas报告
forge test --gas-report

# 显示覆盖率
forge coverage
```

### 部署到测试网

```bash
# 1. 配置环境变量
cp .env.example .env
# 编辑.env填入: PRIVATE_KEY, RPC_URL

# 2. 部署到Sepolia
forge script script/Deploy.s.sol:DeployScript \
    --rpc-url sepolia \
    --broadcast \
    --verify

# 3. 初始化Guardian Set
forge script script/Initialize.s.sol:InitializeScript \
    --rpc-url sepolia \
    --broadcast
```

---

## 参考文档

**详细文档**:
- [API规格说明书](./API-SPEC.md) - 完整接口定义、数据结构、错误码（930行）
- [测试套件规划](./TEST-PLAN.md) - 80个测试用例、测试示例
- [开发进度追踪](./PROGRESS.md) - 里程碑、问题跟踪

**外部资源**:
- [Foundry Book](https://book.getfoundry.sh/)
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts/)
- [Solidity文档](https://docs.soliditylang.org/)

**相关模块**:
- [父项目文档](../../../docs/)
- [SVM子模块](../../svm/)

---

## 许可证

MIT License

---

**维护者**: EVM合约开发团队  
**最后更新**: 2025-11-09

