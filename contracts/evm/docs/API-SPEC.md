# EVM合约子模块 - API规格说明书

> **文档版本**: v1.0  
> **创建日期**: 2025-11-09  
> **子模块**: EVM智能合约  
> **父项目**: 跨链桥项目 (Multi-Signature Cross-Chain Bridge)

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

### 1.1 EVM合约模块简介

EVM合约模块负责处理EVM兼容链上的跨链桥接功能，支持：
- 跨链消息的发布与接收
- ERC20代币的锁定与解锁
- 包装代币的铸造与销毁
- VAA（Verified Action Approval）的验证
- Guardian Set管理

**支持的EVM链**（通过配置）:
- Ethereum (Chain ID: 1)
- BSC (Chain ID: 56)
- Polygon (Chain ID: 137)
- 其他EVM兼容链

---

### 1.2 合约架构

```
┌─────────────────────────────────────────────┐
│            BridgeCore.sol                    │
│  - 核心消息收发                               │
│  - VAA验证                                   │
│  - Guardian Set管理                          │
│  - 防重放保护                                │
└─────────────────────────────────────────────┘
                    ↓ 调用
┌─────────────────────────────────────────────┐
│           TokenVault.sol                     │
│  - ERC20代币锁定/解锁                         │
│  - TokenBinding管理（跨链代币映射）           │
│  - 速率限制                                  │
│  - 手续费管理                                │
└─────────────────────────────────────────────┘
```

---

### 1.3 技术栈

- **语言**: Solidity 0.8.20+
- **开发框架**: Foundry
- **依赖**: OpenZeppelin Contracts v5.0
- **测试**: Foundry Test (forge test)
- **部署**: Foundry Script (forge script)

---

### 1.4 系统参数

```solidity
// 核心参数
uint32 public constant GUARDIAN_SET_EXPIRATION_TIME = 7 days;
uint8 public constant QUORUM = 13;  // 13/19签名门限
uint8 public constant TOTAL_GUARDIANS = 19;

// 速率限制（可配置）
uint256 public maxSingleTransfer = 1_000_000 * 10**6;  // 1M USDC
uint256 public maxDailyTransfer = 10_000_000 * 10**6;  // 10M USDC

// 手续费
uint256 public messageFee = 0.001 ether;  // 跨链消息手续费
```

---

## 2. BridgeCore合约接口

### 2.1 publishMessage

**功能**: 发布跨链消息到Guardian网络

**接口**:
```solidity
function publishMessage(
    uint32 nonce,
    bytes memory payload,
    uint8 consistencyLevel
) external payable returns (uint64 sequence);
```

**参数**:
- `nonce`: 随机数，用于防重放（由用户自定义）
- `payload`: 消息载荷，包含跨链转账信息
- `consistencyLevel`: 确认级别
  - `1`: 即时确认（不安全）
  - `15`: 安全确认（15个区块）
  - `200`: 最终确认（建议使用）

**返回值**:
- `sequence`: 消息序列号，用于查询VAA

**要求**:
- 必须支付消息手续费（`msg.value >= messageFee`）
- 合约未暂停

**Gas消耗**: 约 60,000 - 80,000

**示例**:
```solidity
// 发布跨链消息
bytes memory payload = abi.encodePacked(
    uint8(1),           // payloadType: token transfer
    uint256(1000e6),    // amount
    bytes32(tokenAddress),
    uint16(1),          // source chain
    bytes32(recipient),
    uint16(2)           // target chain: Solana
);

uint64 seq = bridgeCore.publishMessage{value: 0.001 ether}(
    uint32(block.timestamp),
    payload,
    200  // 最终确认
);
```

---

### 2.2 receiveMessage

**功能**: 接收并验证跨链消息（VAA）

**接口**:
```solidity
function receiveMessage(
    bytes memory encodedVAA
) external returns (bool success);
```

**参数**:
- `encodedVAA`: 完整的VAA字节数组，包含Guardian签名

**流程**:
1. 解析VAA结构
2. 验证Guardian签名（至少13/19）
3. 检查Guardian Set有效性
4. 检查VAA未被消费（防重放）
5. 标记VAA已消费
6. 返回成功

**返回值**:
- `success`: 验证是否成功

**要求**:
- VAA签名有效
- 签名数量 >= 门限（13）
- VAA未被消费
- Guardian Set有效

**Gas消耗**: 约 200,000 - 300,000（取决于签名数量）

**错误**:
- `InvalidVAA()`: VAA格式无效
- `InsufficientSignatures()`: 签名数量不足
- `InvalidGuardianSet()`: Guardian Set无效
- `VAAAlreadyConsumed()`: VAA已被消费

---

### 2.3 getCurrentGuardianSetIndex

**功能**: 查询当前Guardian Set索引

**接口**:
```solidity
function getCurrentGuardianSetIndex() 
    external view returns (uint32 index);
```

**返回值**:
- `index`: 当前Guardian Set索引（0, 1, 2, ...）

**用途**:
- 用户查询当前有效的Guardian Set版本
- 判断是否在升级过渡期

---

### 2.4 getGuardianSet

**功能**: 获取指定索引的Guardian Set详情

**接口**:
```solidity
function getGuardianSet(uint32 index) 
    external view returns (GuardianSet memory);

struct GuardianSet {
    address[] keys;           // Guardian公钥列表
    uint32 expirationTime;    // 过期时间（0表示永久有效）
}
```

**参数**:
- `index`: Guardian Set索引

**返回值**:
- `GuardianSet`: Guardian Set结构体

---

### 2.5 isVAAConsumed

**功能**: 检查VAA是否已被消费

**接口**:
```solidity
function isVAAConsumed(bytes32 vaaHash) 
    external view returns (bool);
```

**参数**:
- `vaaHash`: VAA的keccak256哈希

**返回值**:
- `bool`: true表示已消费，false表示未消费

**用途**:
- 防止VAA重复提交
- 用户查询VAA状态

---

## 3. TokenVault合约接口

### 3.1 lockTokens

**功能**: 锁定ERC20代币并发起跨链转账

**接口**:
```solidity
function lockTokens(
    address token,
    uint256 amount,
    uint16 targetChainId,
    bytes32 recipient
) external payable returns (bytes32 transferId);
```

**参数**:
- `token`: ERC20代币合约地址
- `amount`: 转账数量（包含精度）
- `targetChainId`: 目标链ID（2=Solana, 56=BSC等）
- `recipient`: 接收者地址（32字节格式）

**返回值**:
- `transferId`: 转账唯一标识（用于追踪）

**流程**:
1. 检查用户授权（ERC20 allowance）
2. 检查速率限制（单笔限额、每日限额）
3. `transferFrom` 代币到Vault
4. 更新锁定余额
5. 构造跨链payload
6. 调用 `BridgeCore.publishMessage()`
7. 发出 `TokensLocked` 事件

**要求**:
- 用户已授权（`token.approve(vault, amount)`）
- 未超过速率限制
- 支付消息手续费
- 合约未暂停

**Gas消耗**: 约 150,000 - 200,000

**示例**:
```solidity
// 1. 授权代币
IERC20(usdcAddress).approve(vaultAddress, 1000e6);

// 2. 锁定代币并跨链
bytes32 transferId = vault.lockTokens{value: 0.001 ether}(
    usdcAddress,
    1000e6,  // 1000 USDC
    2,       // Solana
    bytes32(uint256(uint160(solanaRecipient)))
);
```

---

### 3.2 unlockTokens

**功能**: 解锁代币（接收跨链转账）

**接口**:
```solidity
function unlockTokens(bytes memory vaa) 
    external returns (bool success);
```

**参数**:
- `vaa`: 包含转账信息的VAA

**流程**:
1. 调用 `BridgeCore.receiveMessage(vaa)` 验证
2. 解析VAA payload获取:
   - 代币地址
   - 转账数量
   - 接收者地址
3. 检查Vault锁定余额充足
4. `transfer` 代币给接收者
5. 更新锁定余额
6. 发出 `TokensUnlocked` 事件

**要求**:
- VAA有效且未消费
- Vault余额充足
- TokenBinding已配置且启用

**Gas消耗**: 约 250,000 - 350,000

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
) external onlyGovernance;
```

**参数**:
- `maxPerTransaction`: 单笔最大转账金额
- `maxPerDay`: 每日最大转账总额

**权限**: 只有Governance多签可调用

---

### 4.4 withdrawFees

**功能**: 提取累积的手续费

**接口**:
```solidity
function withdrawFees(
    address recipient,
    uint256 amount
) external onlyGovernance;
```

**参数**:
- `recipient`: 接收地址（治理多签）
- `amount`: 提取数量（0表示全部）

**权限**: 只有Governance多签可调用

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

// TokenVault事件
event TokensLocked(
    bytes32 indexed transferId,
    address indexed token,
    address indexed sender,
    uint256 amount,
    uint16 targetChain,
    bytes32 recipient
);

event TokensUnlocked(
    bytes32 indexed transferId,
    address indexed token,
    address indexed recipient,
    uint256 amount
);

// 管理事件
event BridgePaused(address indexed by, uint256 timestamp);
event BridgeUnpaused(address indexed by, uint256 timestamp);

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

### 6.2 Token Transfer Payload

```solidity
struct TokenTransferPayload {
    uint8 payloadType;          // 1 = token transfer with exchange
    uint256 amount;             // 源链锁定数量
    bytes32 tokenAddress;       // 源链代币地址
    uint16 tokenChain;          // 源链ID
    bytes32 recipient;          // 接收者地址
    uint16 recipientChain;      // 目标链ID
    bytes32 targetToken;        // 目标链代币地址（用户选择）
    uint64 targetAmount;        // 目标链接收数量（计算后）
    uint64 exchangeRateNum;     // 兑换比率分子
    uint64 exchangeRateDenom;   // 兑换比率分母
}

// 编码示例
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
        amount,                                 // uint256
        bytes32(uint256(uint160(sourceToken))), // bytes32
        sourceChain,                            // uint16
        recipient,                              // bytes32
        recipientChain,                         // uint16
        bytes32(uint256(uint160(targetToken))), // bytes32
        targetAmount,                           // uint64
        rateNum,                                // uint64
        rateDenom                               // uint64
    );
}
```

### 6.3 Guardian Set结构

```solidity
struct GuardianSet {
    address[] keys;           // Guardian公钥列表（20字节）
    uint32 expirationTime;    // 过期时间戳（0=永久有效）
}

mapping(uint32 => GuardianSet) public guardianSets;
uint32 public currentGuardianSetIndex;
```

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

**文档状态**: ✅ v1.0 已完成  
**维护**: EVM合约开发团队  
**最后更新**: 2025-11-09

