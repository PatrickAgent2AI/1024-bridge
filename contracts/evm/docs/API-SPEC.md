# EVM合约子模块 - API规格说明书

> **文档版本**: v2.0  
> **创建日期**: 2025-11-09  
> **最后更新**: 2025-11-10  
> **实现状态**: 📋 设计完成，参考SVM v1.5架构  
> **最新变更**: ✅ 采用TokenBinding机制，集成Gnosis Safe多签

---

## 📋 目录

1. [模块概述](#1-模块概述)
2. [BridgeCore合约接口](#2-bridgecore合约接口)
3. [TokenVault合约接口](#3-tokenvault合约接口)
4. [管理员接口](#4-管理员接口)
5. [事件定义](#5-事件定义)
6. [数据结构定义](#6-数据结构定义)
7. [错误码规范](#7-错误码规范)
8. [接口集成指南](#8-接口集成指南)
9. [安全注意事项](#9-安全注意事项)

---

## 1. 模块概述

### 1.1 合约架构

本子模块包含两个核心合约：

| 合约 | 地址管理 | 功能 | 状态 |
|------|----------|------|------|
| **BridgeCore** | 可升级代理 | VAA验证、Guardian管理 | 📋 设计中 |
| **TokenVault** | 可升级代理 | 代币锁定/解锁、TokenBinding | 📋 设计中 |

**权限管理**:
- 使用Gnosis Safe多签钱包作为`owner`
- 推荐配置：3/5或4/7签名门限
- 所有管理操作需多签批准

**支持的EVM链** (使用行业标准Chain ID):
- Ethereum Mainnet (Chain ID: 1)
- BSC (Chain ID: 56)
- Polygon (Chain ID: 137)
- Arbitrum (Chain ID: 42161)
- Optimism (Chain ID: 10)
- Solana Mainnet (Chain ID: 900) - 跨链目标
- Solana Devnet (Chain ID: 901) - 跨链目标
- 本地测试链 (Chain ID: 65520-65535) - 避免冲突

### 1.2 核心设计概念

#### TokenBinding机制

**为什么采用TokenBinding而非包装代币？**

| 方面 | 包装代币模式 | TokenBinding模式 (本项目) |
|------|-------------|-------------------------|
| **流动性** | 需要新建流动性池 | 利用现有流动性 |
| **兑换灵活性** | 仅支持同币种 | 支持跨币种兑换 |
| **用户体验** | 需要额外兑换步骤 | 一步到位 |
| **实现复杂度** | 需要铸造/销毁逻辑 | 仅需锁定/解锁 |

**双向Binding机制**:

每条链需要记录两种类型的binding：
1. **出站binding** - 用户发起跨链时查询
2. **入站binding** - 接收跨链时验证合法性

**示例**:

Ethereum链上需要注册：
```solidity
// 出站：用户在Ethereum发起transfer
registerTokenBinding(1, eth_usdc, 900, sol_usdc, rate)

// 入站：Relayer提交Solana VAA时验证
registerTokenBinding(900, sol_usdc, 1, eth_usdc, rate)
```

Solana链上需要注册（对称）：
```rust
// 出站：用户在Solana发起transfer  
register_token_binding(900, sol_usdc, 1, eth_usdc, rate)

// 入站：Relayer提交Ethereum VAA时验证
register_token_binding(1, eth_usdc, 900, sol_usdc, rate)
```

#### 多对多关系

一个源代币可以绑定多个目标代币：

**场景**: Ethereum USDC可以兑换成多种目标代币
```solidity
// Ethereum → Solana USDC (1:1)
registerTokenBinding(1, eth_usdc, 900, sol_usdc, 1, 1)

// Ethereum → Solana USDT (费率998:1000)
registerTokenBinding(1, eth_usdc, 900, sol_usdt, 998, 1000)

// Ethereum → BSC BUSD (费率999:1000)
registerTokenBinding(1, eth_usdc, 56, bsc_busd, 999, 1000)
```

用户转账时通过`targetToken`参数选择目标代币。

#### Gnosis Safe多签治理

**设计原则**:
- 所有管理操作必须通过`owner`权限验证
- `owner`设置为Gnosis Safe多签钱包地址
- 推荐配置：3/5或4/7签名门限
- 使用OpenZeppelin's `Ownable`实现

**多签保护的操作**:

| 操作 | 合约 | 权限验证 | 风险等级 |
|------|------|---------|---------|
| `initialize` | BridgeCore | onlyOwner | 🔴 高 |
| `setPaused` | BridgeCore | onlyOwner | 🔴 高 |
| `initialize` | TokenVault | onlyOwner | 🔴 高 |
| `initializeCustody` | TokenVault | onlyOwner | 🟡 中 |
| `registerTokenBinding` | TokenVault | onlyOwner | 🟡 中 |
| `registerBidirectionalBinding` | TokenVault | onlyOwner | 🟡 中 |
| `setExchangeRate` | TokenVault | onlyOwner | 🔴 高 |
| `updateAMMConfig` | TokenVault | onlyOwner | 🟡 中 |
| `setTokenBindingEnabled` | TokenVault | onlyOwner | 🟡 中 |

**部署流程**:
1. 创建Gnosis Safe钱包（3/5或4/7配置）
2. 部署BridgeCore和TokenVault（owner设为Safe地址）
3. 所有管理操作通过Safe界面提交和批准

**与SVM对比**:
- SVM: 使用Squads Protocol多签
- EVM: 使用Gnosis Safe多签
- 效果等价，都实现去中心化治理

---

### 1.3 合约架构

```
┌──────────────────────────────────────────┐
│       Gnosis Safe 多签钱包                │
│    (3/5 或 4/7 签名门限)                  │
└──────────────────────────────────────────┘
                  ↓ owner权限
┌─────────────────────────────────────────────┐
│            BridgeCore.sol                    │
│  - 核心消息收发                               │
│  - VAA验证 (secp256k1 + ECDSA)              │
│  - Guardian Set管理 (13/19门限)             │
│  - 防重放保护                                │
└─────────────────────────────────────────────┘
                    ↓ 调用
┌─────────────────────────────────────────────┐
│           TokenVault.sol                     │
│  - ERC20代币锁定/解锁                         │
│  - TokenBinding管理（多对多映射）             │
│  - 兑换比率验证                              │
│  - 速率限制                                  │
└─────────────────────────────────────────────┘
```

---

### 1.4 技术栈

- **语言**: Solidity ^0.8.20
- **开发框架**: Foundry
- **依赖**: 
  - OpenZeppelin Contracts v5.0 (Ownable, ReentrancyGuard)
  - Gnosis Safe (多签钱包)
- **测试**: Foundry Test (forge test)
- **部署**: Foundry Script (forge script)

---

### 1.5 系统参数

```solidity
// Guardian参数
uint32 public constant GUARDIAN_SET_EXPIRATION_TIME = 7 days;
uint8 public constant QUORUM = 13;  // 13/19签名门限
uint8 public constant TOTAL_GUARDIANS = 19;

// 速率限制（可配置）
uint256 public maxSingleTransfer = 1_000_000 * 10**6;  // 1M USDC
uint256 public maxDailyTransfer = 10_000_000 * 10**6;  // 10M USDC

// 手续费
uint256 public messageFee = 0.001 ether;  // 跨链消息手续费

// TokenBinding
struct TokenBinding {
    uint16 sourceChain;
    bytes32 sourceToken;  // 32字节统一格式
    uint16 targetChain;
    bytes32 targetToken;
    uint64 exchangeRateNumerator;
    uint64 exchangeRateDenominator;
    bool enabled;
}
```

---

### 1.6 与SVM子模块的对称性

| 特性 | SVM (Anchor) | EVM (Solidity) | 一致性 |
|------|--------------|----------------|--------|
| **TokenBinding** | 4元组PDA | 4元组mapping | ✅ 完全一致 |
| **VAA验证** | secp256k1恢复 | ecrecover | ✅ 算法一致 |
| **Guardian门限** | 13/19 | 13/19 | ✅ 参数一致 |
| **Payload格式** | 133字节 | 133字节 | ✅ 格式一致 |
| **多签治理** | Squads | Gnosis Safe | ✅ 功能等价 |
| **兑换比率** | 分子/分母 | 分子/分母 | ✅ 计算一致 |

**参考文档**: [SVM API-SPEC.md](../../svm/docs/API-SPEC.md)

---

## 2. BridgeCore合约接口

### 核心功能说明

**与SVM对比**:
| 功能 | SVM实现 | EVM实现 | 说明 |
|------|---------|---------|------|
| 发布消息 | `post_message` | `publishMessage` | ✅ 功能对等 |
| 接收VAA | `post_vaa` (三步骤) | `receiveMessage` (直接) | ⚠️ EVM无需分块 |
| VAA缓冲 | `init_vaa_buffer` + `append_vaa_chunk` | 不需要 | ❌ Solidity可直接接收大参数 |
| Guardian升级 | `update_guardian_set` | `updateGuardianSet` | ✅ 功能对等 |
| 暂停控制 | `set_paused` | `setPaused` | ✅ 功能对等 |

---

### 2.1 initialize

**功能**: 初始化Bridge和Guardian Set（对应SVM的initialize）

**接口**:
```solidity
function initialize(
    uint32 guardianSetIndex,
    address[] memory guardians,      // 19个Guardian地址
    uint256 messageFee
) external;
```

**参数**:
- `guardianSetIndex`: Guardian Set索引（通常从0开始）
- `guardians`: 19个Guardian地址数组
- `messageFee`: 跨链消息手续费（wei）

**要求**:
- 只能调用一次（使用Initializable模式）
- `msg.sender`自动成为owner
- Guardian数量必须=19

**与SVM差异**:
- SVM需显式传递authority参数，EVM自动使用msg.sender
- SVM使用20字节数组，EVM直接使用address类型

**Gas消耗**: 约 300,000 - 400,000

---

### 2.2 publishMessage

**功能**: 发布跨链消息到Guardian网络（对应SVM的post_message）

**接口**:
```solidity
function publishMessage(
    uint32 nonce,
    bytes memory payload,
    uint8 consistencyLevel
) external payable returns (uint64 sequence);
```

**参数**:
- `nonce`: 随机数（建议使用block.timestamp）
- `payload`: 消息载荷（133字节TokenTransfer或自定义）
- `consistencyLevel`: 确认级别
  - `15`: 安全确认（推荐，对应SVM）
  - `200`: 最终确认

**返回值**:
- `sequence`: 消息序列号（自动递增）

**流程**:
1. 检查手续费: `require(msg.value >= messageFee)`
2. 检查未暂停: `require(!paused)`
3. 自动递增序列号: `sequence = sequences[msg.sender]++`
4. 存储消息（可选，节省gas可不存储）
5. 发出事件: `LogMessagePublished`

**与SVM差异**:
- SVM需要显式传递Sequence账户，EVM自动管理mapping
- SVM需要CPI调用时传递emitter，EVM自动使用msg.sender

**Gas消耗**: 约 50,000 - 70,000

**示例**:
```solidity
// TokenVault调用publishMessage
uint64 seq = bridgeCore.publishMessage{value: 0.001 ether}(
    uint32(block.timestamp),
    tokenTransferPayload,  // 133 bytes
    15  // 安全确认
);
```

---

### 2.3 receiveMessage

**功能**: 接收并验证VAA（对应SVM的post_vaa，但简化为单步）

**接口**:
```solidity
function receiveMessage(
    bytes memory vaa
) external returns (bytes32 vaaHash);
```

**参数**:
- `vaa`: 完整VAA字节数组（包含签名和body）

**返回值**:
- `vaaHash`: VAA的keccak256哈希（用于防重放）

**流程**:
1. 解析VAA头部（version, guardianSetIndex, 签名数量）
2. 提取签名数组（每个65字节: r, s, v, guardianIndex）
3. 计算body哈希: `keccak256(abi.encodePacked(keccak256(body)))`
4. 验证签名数量 >= 13
5. 使用ecrecover验证每个签名
6. 检查Guardian索引有效且无重复
7. 计算vaaHash并检查未消费
8. 标记已消费: `consumedVAAs[vaaHash] = true`
9. 存储PostedVAA（可选）
10. 发出事件: `MessageReceived`

**与SVM差异**:
- **✅ 单步完成**: SVM需三步（init_buffer + append_chunk + post_vaa）
- **✅ 直接传递**: Solidity可接收任意大小bytes参数
- **⚠️ ecrecover**: EVM内置，SVM需手动实现secp256k1

**安全检查**:
```solidity
// 1. 签名验证
require(numSignatures >= 13, "InsufficientSignatures");

// 2. Guardian有效性
GuardianSet memory gs = guardianSets[guardianSetIndex];
require(gs.keys.length > 0, "InvalidGuardianSet");
require(gs.expirationTime == 0 || gs.expirationTime > block.timestamp, "GuardianSetExpired");

// 3. 防重放
bytes32 hash = keccak256(vaa);
require(!consumedVAAs[hash], "VAAAlreadyConsumed");
consumedVAAs[hash] = true;

// 4. 签名恢复和验证
for (uint i = 0; i < numSignatures; i++) {
    address guardian = ecrecover(bodyHash, v, r, s);
    require(gs.keys[guardianIndex] == guardian, "InvalidSignature");
}
```

**Gas消耗**: 约 200,000 + (15,000 × 签名数)
- 13个签名: ~395,000 gas
- 19个签名: ~485,000 gas

**计算预算**: 无需设置（与SVM不同）

---

### 2.4 updateGuardianSet

**功能**: 升级Guardian Set（对应SVM的update_guardian_set）

**接口**:
```solidity
function updateGuardianSet(
    bytes memory vaa  // 包含新Guardian Set的治理VAA
) external;
```

**参数**:
- `vaa`: 由当前Guardian Set签名的治理VAA

**VAA Payload格式**:
```solidity
// Module: Core (0x00), Action: GuardianSetUpgrade (0x02)
struct GuardianSetUpgradePayload {
    bytes32 module;             // 32字节: "Core"
    uint8 action;               // 1字节: 2
    uint16 chain;               // 2字节: 0 (所有链)
    uint32 newGuardianSetIndex; // 4字节
    uint8 guardianCount;        // 1字节: 19
    address[19] newGuardians;   // 380字节
}
```

**流程**:
1. 调用receiveMessage验证VAA
2. 解析payload确认是治理操作
3. 验证module="Core", action=2
4. 创建新Guardian Set
5. 设置旧Set过期时间（当前时间 + 7天）
6. 更新currentGuardianSetIndex
7. 发出GuardianSetUpdated事件

**与SVM差异**:
- SVM需显式传递所有账户，EVM自动管理状态
- 功能完全对等，都支持7天过渡期

**Gas消耗**: 约 500,000 - 600,000

---

### 2.5 setPaused

**功能**: 暂停/恢复Bridge（对应SVM的set_paused）

**接口**:
```solidity
function setPaused(bool paused) external onlyOwner;
```

**参数**:
- `paused`: true=暂停，false=恢复

**影响**:
- 暂停后无法调用publishMessage
- 暂停后无法调用receiveMessage
- 查询函数不受影响

**权限**: onlyOwner (Gnosis Safe多签)

**与SVM差异**:
- SVM使用authority约束，EVM使用onlyOwner
- 功能完全对等

---

### 2.6 查询函数

**getCurrentGuardianSetIndex**:
```solidity
function getCurrentGuardianSetIndex() 
    external view returns (uint32);
```

**getGuardianSet**:
```solidity
function getGuardianSet(uint32 index) 
    external view returns (
        address[] memory keys,
        uint32 expirationTime
    );
```

**isVAAConsumed**:
```solidity
function isVAAConsumed(bytes32 vaaHash) 
    external view returns (bool);
```

**getMessageSequence**:
```solidity
// 对应SVM的Sequence账户
function getMessageSequence(address emitter) 
    external view returns (uint64);
```

**与SVM差异**:
- SVM需要读取Sequence账户，EVM直接查询mapping
- 功能对等，但EVM更简洁

---

## 3. TokenVault合约接口

### 核心功能说明

**与SVM对比**:
| 功能 | SVM实现 | EVM实现 | 说明 |
|------|---------|---------|------|
| 锁定代币 | `transfer_tokens` | `lockTokens` | ✅ 功能对等 |
| 解锁代币 | `complete_transfer` | `unlockTokens` | ✅ 功能对等 |
| 注册绑定 | `register_token_binding` | `registerTokenBinding` | ✅ 功能对等 |
| 双向绑定 | `register_bidirectional_binding` | `registerBidirectionalBinding` | ✅ 功能对等 |
| 设置比率 | `set_exchange_rate` | `setExchangeRate` | ✅ 功能对等 |
| 初始化托管 | `initialize_custody` | `initializeCustody` | ⚠️ EVM简化实现 |

---

### 3.1 initialize

**功能**: 初始化TokenVault配置（对应SVM的initialize）

**接口**:
```solidity
function initialize(address bridgeCore) external;
```

**参数**:
- `bridgeCore`: BridgeCore合约地址

**要求**:
- 只能调用一次
- `msg.sender`自动成为owner

**与SVM差异**:
- SVM需要传递authority参数，EVM自动使用msg.sender
- SVM需要初始化BridgeConfig账户，EVM直接初始化状态变量

---

### 3.2 lockTokens

**功能**: 锁定ERC20代币并发起跨链转账（对应SVM的transfer_tokens）

**接口**:
```solidity
function lockTokens(
    address sourceToken,
    uint256 amount,
    uint16 targetChain,
    bytes32 targetToken,
    bytes32 recipient
) external payable returns (uint64 sequence);
```

**参数**:
- `sourceToken`: ERC20代币合约地址
- `amount`: 转账数量（需与代币decimals匹配）
- `targetChain`: 目标链ID（900=Solana, 901=Solana Devnet）
- `targetToken`: 目标代币地址（32字节格式）
- `recipient`: 接收者地址（32字节格式）

**返回值**:
- `sequence`: 消息序列号（用于查询VAA）

**流程**:
1. **查询TokenBinding**: 
   ```solidity
   bytes32 bindingKey = getBindingKey(
       uint16(block.chainid), 
       toBytes32(sourceToken), 
       targetChain, 
       targetToken
   );
   TokenBinding storage binding = tokenBindings[bindingKey];
   require(binding.enabled, "TokenBindingNotEnabled");
   ```

2. **计算目标金额**:
   ```solidity
   uint64 targetAmount = uint64(
       (amount * binding.exchangeRateNumerator) / 
       binding.exchangeRateDenominator
   );
   ```

3. **锁定代币**:
   ```solidity
   IERC20(sourceToken).transferFrom(msg.sender, address(this), amount);
   custodyBalances[sourceToken] += amount;
   ```

4. **构造133字节Payload** (与SVM完全一致):
   ```solidity
   bytes memory payload = abi.encodePacked(
       uint8(1),                      // payloadType
       uint64(amount),                // amount (8 bytes, Big Endian)
       toBytes32(sourceToken),        // tokenAddress (32 bytes)
       uint16(block.chainid),         // tokenChain (2 bytes, Big Endian)
       recipient,                     // recipient (32 bytes)
       targetChain,                   // recipientChain (2 bytes, Big Endian)
       targetToken,                   // targetToken (32 bytes)
       targetAmount,                  // targetAmount (8 bytes, Big Endian)
       binding.exchangeRateNumerator, // exchangeRateNum (8 bytes)
       binding.exchangeRateDenominator // exchangeRateDenom (8 bytes)
   ); // Total: 133 bytes
   ```

5. **发布消息**:
   ```solidity
   uint64 seq = IBridgeCore(bridgeCore).publishMessage{value: msg.value}(
       uint32(block.timestamp),
       payload,
       15  // consistencyLevel
   );
   ```

6. **发出事件**:
   ```solidity
   emit TokensLocked(
       msg.sender,
       sourceToken,
       amount,
       targetChain,
       targetToken,
       recipient,
       seq,
       targetAmount
   );
   ```

**与SVM差异**:
- **✅ 功能对等**: 都支持跨币种兑换
- **✅ Payload一致**: 133字节格式完全相同
- **⚠️ 调用方式**: SVM通过CPI调用post_message，EVM直接调用接口
- **⚠️ Custody**: SVM使用PDA托管账户，EVM使用合约自身持有

**安全检查**:
```solidity
require(binding.enabled, "TokenBindingNotEnabled");
require(amount > 0, "ZeroAmount");
require(targetChain != block.chainid, "SameChain");
require(msg.value >= IBridgeCore(bridgeCore).messageFee(), "InsufficientFee");
require(!paused, "Paused");
```

**Gas消耗**: 约 150,000 - 200,000

**示例**:
```solidity
// Ethereum → Solana USDC (1:1)
uint64 seq = vault.lockTokens{value: 0.001 ether}(
    0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48,  // USDC on Ethereum
    1000e6,                                      // 1000 USDC
    900,                                         // Solana Mainnet
    bytes32(uint256(uint160(solanaUSDC))),       // Solana USDC
    bytes32(uint256(uint160(recipientAddress)))  // Solana recipient
);
```

---

### 3.3 unlockTokens

**功能**: 验证VAA并解锁代币（对应SVM的complete_transfer）

**接口**:
```solidity
function unlockTokens(bytes memory vaa) 
    external returns (bool success);
```

**参数**:
- `vaa`: 完整VAA（包含133字节TokenTransfer payload）

**流程**:

1. **验证VAA**:
   ```solidity
   bytes32 vaaHash = IBridgeCore(bridgeCore).receiveMessage(vaa);
   ```

2. **解析Payload** (133字节):
   ```solidity
   TokenTransferPayload memory transfer = parseTransferPayload(
       extractPayloadFromVAA(vaa)
   );
   
   // 提取字段
   uint64 amount = transfer.amount;
   bytes32 sourceToken = transfer.tokenAddress;
   uint16 sourceChain = transfer.tokenChain;
   bytes32 recipient = transfer.recipient;
   uint16 recipientChain = transfer.recipientChain;
   bytes32 targetToken = transfer.targetToken;
   uint64 targetAmount = transfer.targetAmount;
   uint64 rateNum = transfer.exchangeRateNum;
   uint64 rateDenom = transfer.exchangeRateDenom;
   ```

3. **验证目标链**:
   ```solidity
   require(
       recipientChain == uint16(block.chainid), 
       "WrongChain"
   );
   ```

4. **查询TokenBinding** (入站验证):
   ```solidity
   bytes32 bindingKey = getBindingKey(
       sourceChain,
       sourceToken,
       recipientChain,  // 当前链
       targetToken
   );
   TokenBinding storage binding = tokenBindings[bindingKey];
   require(binding.enabled, "TokenBindingNotEnabled");
   ```

5. **验证兑换比率** (防篡改):
   ```solidity
   require(
       binding.exchangeRateNumerator == rateNum &&
       binding.exchangeRateDenominator == rateDenom,
       "ExchangeRateMismatch"
   );
   
   // 重新计算验证
   uint64 expectedAmount = uint64(
       (amount * rateNum) / rateDenom
   );
   require(expectedAmount == targetAmount, "AmountMismatch");
   ```

6. **检查余额并解锁**:
   ```solidity
   address targetTokenAddr = toAddress(targetToken);
   require(
       custodyBalances[targetTokenAddr] >= targetAmount,
       "InsufficientCustody"
   );
   
   custodyBalances[targetTokenAddr] -= targetAmount;
   IERC20(targetTokenAddr).transfer(
       toAddress(recipient),
       targetAmount
   );
   ```

7. **发出事件**:
   ```solidity
   emit TokensUnlocked(
       vaaHash,
       toAddress(recipient),
       targetTokenAddr,
       targetAmount,
       sourceChain,
       sourceToken
   );
   ```

**与SVM差异**:
- **✅ 功能对等**: 都验证入站binding和兑换比率
- **✅ 安全检查**: 5项验证完全一致
- **⚠️ VAA消费**: SVM通过CPI调用mark_vaa_consumed，EVM在receiveMessage中自动标记
- **⚠️ Custody**: SVM从PDA转账，EVM从合约自身转账

**安全检查清单**:
```solidity
✅ 1. VAA签名验证（13/19 Guardian签名）
✅ 2. VAA防重放（consumedVAAs mapping）
✅ 3. 目标链匹配（recipientChain == block.chainid）
✅ 4. TokenBinding存在且启用
✅ 5. 兑换比率一致性（防篡改）
✅ 6. 目标金额计算正确
✅ 7. Custody余额充足
```

**Gas消耗**: 约 450,000 - 550,000
- VAA验证（13签名）: ~395,000
- Payload解析: ~20,000
- TokenBinding查询: ~5,000
- ERC20转账: ~30,000
- 存储更新: ~20,000

**示例**:
```solidity
// Solana → Ethereum 完成跨链
// VAA由Guardian生成，包含所有验证信息
bool success = vault.unlockTokens(vaaFromGuardian);
require(success, "Transfer failed");

// 用户会收到targetAmount的targetToken
// 例如：从Solana转1000 USDC，Ethereum收到1000 USDC
```

**与SVM complete_transfer对比**:
| 验证项 | SVM | EVM | 一致性 |
|--------|-----|-----|--------|
| VAA签名验证 | ✅ | ✅ | ✅ |
| 入站TokenBinding | ✅ | ✅ | ✅ |
| 兑换比率验证 | ✅ | ✅ | ✅ |
| 目标链验证 | ✅ | ✅ | ✅ |
| Custody余额 | ✅ | ✅ | ✅ |
| VAA消费标记 | CPI | 自动 | ⚠️ 实现不同 |

**双向桥接验证**:
- **Ethereum → Solana**: Ethereum.lockTokens → Solana.complete_transfer ✅
- **Solana → Ethereum**: Solana.transfer_tokens → Ethereum.unlockTokens ✅

---

### 3.3 registerTokenBinding

**功能**: 注册单向代币绑定（管理员专用）

**接口**:
```solidity
function registerTokenBinding(
    uint16 sourceChain,
    bytes32 sourceToken,
    uint16 targetChain,
    bytes32 targetToken,
    uint64 exchangeRateNumerator,
    uint64 exchangeRateDenominator
) external onlyOwner;
```

**参数**:
- `sourceChain`: 源链ID
- `sourceToken`: 源代币地址（32字节格式）
- `targetChain`: 目标链ID
- `targetToken`: 目标代币地址（32字节格式）
- `exchangeRateNumerator`: 兑换比率分子
- `exchangeRateDenominator`: 兑换比率分母（不能为0）

**流程**:
1. 验证owner权限（Gnosis Safe多签）
2. 验证rateDenominator != 0
3. 构造4元组key：keccak256(sourceChain, sourceToken, targetChain, targetToken)
4. 检查binding不存在（防重复）
5. 创建TokenBinding结构
6. 存储到mapping
7. 发出 `TokenBindingRegistered` 事件

**权限**: onlyOwner (Gnosis Safe多签)

**Gas消耗**: 约 80,000 - 100,000

**示例**:
```solidity
// 注册Ethereum USDC → Solana USDC (1:1)
vault.registerTokenBinding(
    1,                              // Ethereum
    bytes32(uint256(uint160(ethUSDC))),
    900,                            // Solana
    bytes32(uint256(solUSDC)),
    1,                              // rate: 1
    1                               // /1
);
```

---

### 3.4 registerBidirectionalBinding

**功能**: 一次调用注册双向代币绑定（推荐使用）

**接口**:
```solidity
function registerBidirectionalBinding(
    uint16 localChain,
    bytes32 localToken,
    uint16 remoteChain,
    bytes32 remoteToken,
    uint64 outboundRateNum,         // 出站比率分子
    uint64 outboundRateDenom,       // 出站比率分母
    uint64 inboundRateNum,          // 入站比率分子
    uint64 inboundRateDenom         // 入站比率分母
) external onlyOwner;
```

**参数**:
- `localChain`: 本链ID
- `localToken`: 本链代币地址
- `remoteChain`: 远程链ID
- `remoteToken`: 远程链代币地址
- `outboundRateNum/Denom`: 出站兑换比率（本链→远程链）
- `inboundRateNum/Denom`: 入站兑换比率（远程链→本链）

**效果**:
自动注册两个TokenBinding：
1. 出站：`(localChain, localToken, remoteChain, remoteToken)` - 用户发起跨链时查询
2. 入站：`(remoteChain, remoteToken, localChain, localToken)` - 接收跨链时验证

**优势**:
- 简化配置，一次调用完成双向设置
- 支持不对称比率（考虑手续费）
- 与SVM子模块设计对称

**权限**: onlyOwner (Gnosis Safe多签)

**Gas消耗**: 约 150,000 - 180,000

**示例**:
```solidity
// Ethereum链上注册与Solana的双向绑定
vault.registerBidirectionalBinding(
    1,                              // Ethereum
    bytes32(uint256(uint160(ethUSDC))),
    900,                            // Solana
    bytes32(uint256(solUSDC)),
    1, 1,                           // 出站: 1:1
    1, 1                            // 入站: 1:1
);

// 跨币种兑换示例（Ethereum USDC ↔ Solana USDT）
vault.registerBidirectionalBinding(
    1,                              // Ethereum
    bytes32(uint256(uint160(ethUSDC))),
    900,                            // Solana
    bytes32(uint256(solUSDT)),
    998, 1000,                      // 出站: 998 USDT每1000 USDC
    1002, 1000                      // 入站: 1002 USDC每1000 USDT
);
```

---

### 3.5 setExchangeRate

**功能**: 动态更新TokenBinding的兑换比率

**接口**:
```solidity
function setExchangeRate(
    uint16 sourceChain,
    bytes32 sourceToken,
    uint16 targetChain,
    bytes32 targetToken,
    uint64 newRateNumerator,
    uint64 newRateDenominator
) external onlyOwner;
```

**参数**:
- 4元组：定位具体的TokenBinding
- `newRateNumerator`: 新的兑换比率分子
- `newRateDenominator`: 新的兑换比率分母

**流程**:
1. 验证owner权限
2. 查询TokenBinding是否存在
3. 验证newRateDenominator != 0
4. 更新兑换比率
5. 发出 `ExchangeRateUpdated` 事件

**用途**:
- 根据市场波动调整兑换比率
- 调整跨链手续费
- 响应流动性变化

**权限**: onlyOwner (Gnosis Safe多签)

**Gas消耗**: 约 30,000 - 50,000

**示例**:
```solidity
// 更新USDC→USDT兑换比率
vault.setExchangeRate(
    1,                              // Ethereum
    bytes32(uint256(uint160(ethUSDC))),
    900,                            // Solana
    bytes32(uint256(solUSDT)),
    997, 1000                       // 新比率: 997:1000
);
```

---

### 3.6 setTokenBindingEnabled

**功能**: 启用或禁用TokenBinding

**接口**:
```solidity
function setTokenBindingEnabled(
    uint16 sourceChain,
    bytes32 sourceToken,
    uint16 targetChain,
    bytes32 targetToken,
    bool enabled
) external onlyOwner;
```

**参数**:
- 4元组：定位具体的TokenBinding
- `enabled`: true=启用, false=禁用

**用途**:
- 临时禁用某个跨链对（如发现安全问题）
- 维护期间暂停特定路径
- 重新启用已禁用的binding

**权限**: onlyOwner (Gnosis Safe多签)

**Gas消耗**: 约 20,000 - 30,000

---

### 3.7 updateAMMConfig

**功能**: 配置外部AMM集成（预留接口）

**接口**:
```solidity
function updateAMMConfig(
    address ammAddress,
    bool enabled
) external onlyOwner;
```

**参数**:
- `ammAddress`: 外部AMM合约地址
- `enabled`: 是否启用

**说明**:
- 当前版本使用固定兑换比率
- 未来版本可集成Uniswap/Curve等AMM
- AMM可提供动态定价

**权限**: onlyOwner (Gnosis Safe多签)

---

## 4. 管理员接口

### 4.1 updateGuardianSet

**功能**: 升级Guardian Set

**接口**:
```solidity
function updateGuardianSet(bytes memory vaa) 
    external;
```

**参数**:
- `vaa`: 包含新Guardian Set的VAA（由旧Guardian Set签名）

**VAA Payload格式**:
```solidity
struct GuardianSetUpgrade {
    uint8 module;   // 0x01 (Core)
    uint8 action;   // 0x02 (GuardianSetUpgrade)
    uint16 chain;   // 0 (all chains)
    uint32 newGuardianSetIndex;
    address[] newGuardianKeys;
}
```

**流程**:
1. 验证VAA（由当前Guardian Set签名）
2. 解析新Guardian Set信息
3. 存储新Guardian Set（状态: pending）
4. 设置旧Set过期时间（7天后）
5. 激活新Set

**权限**: 通过VAA验证（去中心化治理）

---

### 4.2 setPaused

**功能**: 紧急暂停/恢复合约

**接口**:
```solidity
function setPaused(bool paused) 
    external onlyGovernance;
```

**参数**:
- `paused`: true=暂停，false=恢复

**权限**: 只有Governance多签可调用

**影响**:
- 暂停后无法发送/接收跨链消息
- 暂停后无法锁定/解锁代币
- 查询功能不受影响

---

### 4.3 setRateLimit

**功能**: 设置速率限制

**接口**:
```solidity
function setRateLimit(
    uint256 maxPerTransaction,
    uint256 maxPerDay
) external onlyOwner;
```

**参数**:
- `maxPerTransaction`: 单笔最大转账金额
- `maxPerDay`: 每日最大转账总额

**权限**: onlyOwner (Gnosis Safe多签)

---

### 4.4 withdrawFees

**功能**: 提取累积的手续费

**接口**:
```solidity
function withdrawFees(
    address payable recipient,
    uint256 amount
) external onlyOwner;
```

**参数**:
- `recipient`: 接收地址（Gnosis Safe地址）
- `amount`: 提取数量（0表示全部）

**权限**: onlyOwner (Gnosis Safe多签)

---

### 4.5 initializeCustody

**功能**: 初始化代币托管账户

**接口**:
```solidity
function initializeCustody(
    address token
) external onlyOwner;
```

**参数**:
- `token`: ERC20代币合约地址

**流程**:
1. 验证owner权限
2. 验证token地址有效
3. 初始化托管记录
4. 发出 `CustodyInitialized` 事件

**用途**:
- 为新代币初始化托管
- 预先批准代币用于跨链
- 设置初始锁定余额为0

**权限**: onlyOwner (Gnosis Safe多签)

---

## 5. 事件定义

### 5.1 核心事件

```solidity
// BridgeCore事件
event LogMessagePublished(
    address indexed sender,
    uint64 sequence,
    uint32 nonce,
    bytes payload,
    uint8 consistencyLevel
);

event MessageReceived(
    bytes32 indexed vaaHash,
    uint16 sourceChain,
    uint64 sequence
);

event GuardianSetUpdated(
    uint32 indexed oldIndex,
    uint32 indexed newIndex
);

event BridgePaused(address indexed by, uint256 timestamp);
event BridgeUnpaused(address indexed by, uint256 timestamp);

// TokenVault事件
event TokensLocked(
    bytes32 indexed transferId,
    address indexed sourceToken,
    address indexed sender,
    uint256 amount,
    uint16 targetChain,
    bytes32 targetToken,        // 新增：目标代币
    bytes32 recipient,
    uint256 targetAmount        // 新增：目标金额
);

event TokensUnlocked(
    bytes32 indexed transferId,
    address indexed targetToken,
    address indexed recipient,
    uint256 amount,
    uint16 sourceChain,
    bytes32 sourceToken         // 新增：源代币信息
);

// TokenBinding事件（新增）
event TokenBindingRegistered(
    uint16 indexed sourceChain,
    bytes32 indexed sourceToken,
    uint16 indexed targetChain,
    bytes32 targetToken,
    uint64 exchangeRateNumerator,
    uint64 exchangeRateDenominator
);

event TokenBindingUpdated(
    uint16 indexed sourceChain,
    bytes32 indexed sourceToken,
    uint16 indexed targetChain,
    bytes32 targetToken,
    bool enabled
);

event ExchangeRateUpdated(
    uint16 indexed sourceChain,
    bytes32 indexed sourceToken,
    uint16 indexed targetChain,
    bytes32 targetToken,
    uint64 oldRateNumerator,
    uint64 oldRateDenominator,
    uint64 newRateNumerator,
    uint64 newRateDenominator
);

event CustodyInitialized(
    address indexed token,
    uint256 timestamp
);

// 管理事件
event RateLimitUpdated(
    uint256 maxPerTransaction,
    uint256 maxPerDay,
    uint256 timestamp
);

event FeesWithdrawn(
    address indexed recipient,
    uint256 amount,
    uint256 timestamp
);

event AMMConfigUpdated(
    address indexed ammAddress,
    bool enabled,
    uint256 timestamp
);
```

---

## 6. 数据结构定义

### 6.1 VAA结构

```solidity
struct VAA {
    uint8 version;
    uint32 guardianSetIndex;
    Signature[] signatures;
    
    // Body
    uint32 timestamp;
    uint32 nonce;
    uint16 emitterChain;
    bytes32 emitterAddress;
    uint64 sequence;
    uint8 consistencyLevel;
    bytes payload;
}

struct Signature {
    uint8 guardianIndex;
    bytes32 r;
    bytes32 s;
    uint8 v;
}
```

### 6.2 TokenBinding结构（核心）

```solidity
struct TokenBinding {
    uint16 sourceChain;
    bytes32 sourceToken;                // 32字节统一格式
    uint16 targetChain;
    bytes32 targetToken;                // 32字节统一格式
    uint64 exchangeRateNumerator;       // 兑换比率分子
    uint64 exchangeRateDenominator;     // 兑换比率分母
    bool enabled;                       // 是否启用
}

// 存储结构
mapping(bytes32 => TokenBinding) public tokenBindings;

// 4元组key计算
function getBindingKey(
    uint16 sourceChain,
    bytes32 sourceToken,
    uint16 targetChain,
    bytes32 targetToken
) public pure returns (bytes32) {
    return keccak256(abi.encodePacked(
        sourceChain,
        sourceToken,
        targetChain,
        targetToken
    ));
}

// 地址转换（EVM地址 → 32字节格式）
function toBytes32(address addr) public pure returns (bytes32) {
    return bytes32(uint256(uint160(addr)));
}

// 地址转换（32字节格式 → EVM地址）
function toAddress(bytes32 b) public pure returns (address) {
    return address(uint160(uint256(b)));
}
```

**设计说明**:
- 与SVM完全一致的4元组映射
- 支持多对多关系（一个源代币可绑定多个目标代币）
- enabled字段支持动态启用/禁用
- 兑换比率用64位整数表示，避免浮点运算

---

### 6.3 Token Transfer Payload（133字节）

```solidity
struct TokenTransferPayload {
    uint8 payloadType;          // 固定值1
    uint256 amount;             // 源链锁定数量（32字节）
    bytes32 tokenAddress;       // 源链代币地址（32字节）
    uint16 tokenChain;          // 源链ID（2字节）
    bytes32 recipient;          // 接收者地址（32字节）
    uint16 recipientChain;      // 目标链ID（2字节）
    bytes32 targetToken;        // 目标链代币地址（32字节）
    uint64 targetAmount;        // 目标链接收数量（8字节）
    uint64 exchangeRateNum;     // 兑换比率分子（8字节）
    uint64 exchangeRateDenom;   // 兑换比率分母（8字节）
}
// 总大小：1 + 32 + 32 + 2 + 32 + 2 + 32 + 8 + 8 + 8 = 157字节（序列化后133字节，因为uint256按8字节存储）
```

**Payload编码（与SVM完全一致）**:

| Offset | Size | Field | 说明 |
|--------|------|-------|------|
| 0 | 1 | payloadType | 固定值1 |
| 1 | 8 | amount | 源链锁定数量（Big Endian） |
| 9 | 32 | tokenAddress | 源链代币地址 |
| 41 | 2 | tokenChain | 源链ID（Big Endian） |
| 43 | 32 | recipient | 接收者地址 |
| 75 | 2 | recipientChain | 目标链ID（Big Endian） |
| 77 | 32 | targetToken | 目标链代币地址 |
| 109 | 8 | targetAmount | 目标链接收数量（Big Endian） |
| 117 | 8 | exchangeRateNum | 兑换比率分子（Big Endian） |
| 125 | 8 | exchangeRateDenom | 兑换比率分母（Big Endian） |

**编码示例**:
```solidity
function encodeTransferPayload(
    uint256 amount,
    address sourceToken,
    uint16 sourceChain,
    bytes32 recipient,
    uint16 recipientChain,
    address targetToken,
    uint64 targetAmount,
    uint64 rateNum,
    uint64 rateDenom
) internal pure returns (bytes memory) {
    return abi.encodePacked(
        uint8(1),                               // payloadType
        uint64(amount),                         // amount（使用uint64）
        toBytes32(sourceToken),                 // bytes32
        sourceChain,                            // uint16
        recipient,                              // bytes32
        recipientChain,                         // uint16
        toBytes32(targetToken),                 // bytes32
        targetAmount,                           // uint64
        rateNum,                                // uint64
        rateDenom                               // uint64
    );
}

// 解码示例
function decodeTransferPayload(bytes memory payload) 
    internal pure returns (TokenTransferPayload memory) 
{
    require(payload.length == 133, "Invalid payload length");
    require(uint8(payload[0]) == 1, "Invalid payload type");
    
    TokenTransferPayload memory transfer;
    uint256 offset = 1;
    
    transfer.amount = uint256(uint64(bytes8(slice(payload, offset, 8))));
    offset += 8;
    transfer.tokenAddress = bytes32(slice(payload, offset, 32));
    offset += 32;
    transfer.tokenChain = uint16(bytes2(slice(payload, offset, 2)));
    offset += 2;
    transfer.recipient = bytes32(slice(payload, offset, 32));
    offset += 32;
    transfer.recipientChain = uint16(bytes2(slice(payload, offset, 2)));
    offset += 2;
    transfer.targetToken = bytes32(slice(payload, offset, 32));
    offset += 32;
    transfer.targetAmount = uint64(bytes8(slice(payload, offset, 8)));
    offset += 8;
    transfer.exchangeRateNum = uint64(bytes8(slice(payload, offset, 8)));
    offset += 8;
    transfer.exchangeRateDenom = uint64(bytes8(slice(payload, offset, 8)));
    
    return transfer;
}
```

**重要说明**:
- **与SVM完全一致**: 133字节格式，可直接跨链传递
- **Big Endian**: 数值字段使用Big Endian编码
- **32字节地址**: EVM地址转为bytes32（左填充0）
- **金额精度**: amount和targetAmount保持原始精度

---

### 6.4 Guardian Set结构

```solidity
struct GuardianSet {
    address[] keys;           // Guardian公钥列表（20字节EVM地址）
    uint32 expirationTime;    // 过期时间戳（0=永久有效）
}

mapping(uint32 => GuardianSet) public guardianSets;
uint32 public currentGuardianSetIndex;
```

**说明**:
- Guardian地址使用EVM格式（20字节）
- 与secp256k1公钥恢复的地址一致
- 13/19签名门限（与SVM一致）

---

### 6.5 Chain ID规范（与SVM一致）

**主网Chain ID** (行业标准):

| Chain ID | 网络 | 类型 | 说明 |
|----------|------|------|------|
| 1 | Ethereum Mainnet | EVM | 以太坊主网 |
| 56 | BSC | EVM | 币安智能链 |
| 137 | Polygon | EVM | Polygon主网 |
| 42161 | Arbitrum One | EVM | Arbitrum主网 |
| 10 | Optimism | EVM | Optimism主网 |
| 900 | Solana Mainnet | SVM | Solana主网 |

**测试网Chain ID**:

| Chain ID | 网络 | 类型 | 说明 |
|----------|------|------|------|
| 11155111 | Sepolia | EVM | 以太坊测试网 |
| 97 | BSC Testnet | EVM | BSC测试网 |
| 80001 | Mumbai | EVM | Polygon测试网 |
| 421613 | Arbitrum Goerli | EVM | Arbitrum测试网 |
| 420 | Optimism Goerli | EVM | Optimism测试网 |
| 901 | Solana Devnet | SVM | Solana开发网 |

**本地测试链** (避免冲突):

| Chain ID | 用途 | 说明 |
|----------|------|------|
| 65520-65535 | 本地测试 | 使用大魔数避免与主流测试网/开发网冲突 |

**使用示例**:
```solidity
// Foundry本地测试
uint16 constant LOCAL_CHAIN_ID = 65520;

// 跨链到Solana主网
uint16 targetChain = 900;

// 跨链到Solana Devnet
uint16 targetChain = 901;

// 跨链到Ethereum主网
uint16 targetChain = 1;
```

**重要说明**:
- ✅ 使用行业标准Chain ID (如EIP-155)
- ✅ Solana使用Wormhole标准ID (900/901)
- ✅ 本地测试使用65520-65535避免冲突
- ❌ 不使用Foundry默认的31337 (可能与某些测试网冲突)
- ❌ 不使用1337等常见本地测试ID

**完整Chain ID列表**: 参见 [Chainlist.org](https://chainlist.org/) 和 [Wormhole文档](https://docs.wormhole.com/)

**与SVM对称性**: 本规范与SVM子模块完全一致，确保跨链互操作性。

---

## 7. 错误码规范

### 7.1 自定义错误

```solidity
// BridgeCore错误
error InsufficientFee();
error InvalidVAA();
error VAAAlreadyConsumed();
error InvalidGuardianSet();
error InsufficientSignatures();
error InvalidSignature();
error BridgePaused();
error Unauthorized();

// TokenVault错误
error ExceedsRateLimit();
error InsufficientBalance();
error InvalidToken();
error InvalidChainId();
error InvalidRecipient();
error TransferFailed();
```

### 7.2 错误处理示例

```solidity
function lockTokens(
    address token,
    uint256 amount,
    uint16 targetChainId,
    bytes32 recipient
) external payable returns (bytes32) {
    // 检查手续费
    if (msg.value < messageFee) {
        revert InsufficientFee();
    }
    
    // 检查速率限制
    if (amount > maxSingleTransfer) {
        revert ExceedsRateLimit();
    }
    
    // 检查目标链
    if (targetChainId == 0 || targetChainId == block.chainid) {
        revert InvalidChainId();
    }
    
    // ... 继续执行
}
```

---

## 8. 接口集成指南

### 8.1 用户跨链转账流程

**步骤1: 授权代币**
```solidity
IERC20(tokenAddress).approve(vaultAddress, amount);
```

**步骤2: 锁定代币**
```solidity
bytes32 transferId = vault.lockTokens{value: 0.001 ether}(
    tokenAddress,
    amount,
    targetChainId,
    recipientBytes32
);
```

**步骤3: 等待Guardian签名**
- 查询Guardian API: `GET /v1/signed_vaa/{chain}/{emitter}/{sequence}`
- 等待VAA生成（约30秒）

**步骤4: 在目标链接收**
- 由Relayer自动提交，或用户手动提交
- 调用目标链的 `unlockTokens(vaa)`（通过TokenBinding机制解锁对应代币）

---

### 8.2 合约间调用关系

```
用户合约
    ↓
TokenVault.lockTokens()
    ↓
BridgeCore.publishMessage()
    ↓
发出 LogMessagePublished 事件
    ↓
Guardian监听并签名
    ↓
生成VAA
    ↓
Relayer获取VAA
    ↓
目标链: BridgeCore.receiveMessage(vaa)
    ↓
TokenVault.unlockTokens()（通过TokenBinding机制）
```

---

## 9. 安全注意事项

### 9.1 重入保护

所有状态修改函数都应使用 `nonReentrant` modifier：

```solidity
function lockTokens(...) 
    external 
    payable 
    nonReentrant 
    whenNotPaused 
    returns (bytes32) 
{
    // ...
}
```

### 9.2 整数溢出保护

使用 Solidity 0.8+ 内置的溢出检查，或显式使用 SafeMath。

### 9.3 权限控制

```solidity
modifier onlyGovernance() {
    if (msg.sender != governance) {
        revert Unauthorized();
    }
    _;
}

modifier onlyBridge() {
    if (msg.sender != bridgeAddress) {
        revert OnlyBridge();
    }
    _;
}
```

### 9.4 暂停机制

所有关键操作都应检查暂停状态：

```solidity
modifier whenNotPaused() {
    if (paused) {
        revert BridgePaused();
    }
    _;
}
```

---

## 附录

### A. Chain ID参考表

| Chain ID | 链名称 | 主网RPC | 测试网RPC |
|---------|-------|---------|----------|
| 1 | Ethereum | https://eth.llamarpc.com | https://sepolia.infura.io |
| 56 | BSC | https://bsc-dataseed.binance.org | https://data-seed-prebsc-1-s1.binance.org |
| 137 | Polygon | https://polygon-rpc.com | https://rpc-mumbai.maticvigil.com |

### B. Gas估算参考

| 操作 | 估算Gas | 备注 |
|-----|---------|------|
| publishMessage | 60,000 - 80,000 | 基础消息发布 |
| receiveMessage | 200,000 - 300,000 | 13个签名验证 |
| lockTokens | 150,000 - 200,000 | 包含publishMessage |
| unlockTokens | 250,000 - 350,000 | 包含receiveMessage |

### C. 相关链接

- [父项目文档](../../../docs/)
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts/)
- [Foundry Book](https://book.getfoundry.sh/)

---

**文档状态**: ✅ v2.0 已完成  
**维护**: EVM合约开发团队  
**最后更新**: 2025-11-10

---

## 版本变更记录

### v2.0 (2025-11-10)

**重大更新**:
1. ✅ 采用TokenBinding机制（替代包装代币）
2. ✅ 集成Gnosis Safe多签钱包
3. ✅ 统一Chain ID规范（与SVM一致）
4. ✅ 支持跨币种兑换
5. ✅ 133字节Payload与SVM对称

**Chain ID变更**:
- ✅ 使用行业标准Chain ID (EIP-155, Wormhole)
- ✅ Solana Mainnet: 900
- ✅ Solana Devnet: 901
- ✅ 本地测试: 65520-65535 (大魔数避免冲突)
- ❌ 移除非标准ID如31337, 1337等

**接口变更**:
- `lockTokens`: 新增`targetToken`参数支持跨币种兑换
- 新增: `registerBidirectionalBinding` - 双向绑定注册
- 新增: `setExchangeRate` - 动态调整兑换比率
- 新增: `setTokenBindingEnabled` - 启用/禁用绑定
- 新增: `updateAMMConfig` - AMM集成（预留）

**数据结构变更**:
- 新增: `TokenBinding` - 4元组映射结构
- 扩展: `TokensLocked`事件 - 包含targetToken和targetAmount
- 扩展: `TokenTransferPayload` - 133字节（与SVM一致）

**参考文档**:
- SVM子模块: [../svm/docs/API-SPEC.md](../../svm/docs/API-SPEC.md)
- Chain ID规范: [6.5 Chain ID规范](#65-chain-id规范与svm一致)

