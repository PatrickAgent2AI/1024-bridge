# 跨链桥项目 - API规格说明书

> **文档版本**: v2.2  
> **创建日期**: 2025-11-08  
> **最后更新**: 2025-11-10  
> **更新说明**: 
> - v2.2: 文档修订 - 突出TokenBinding机制，减少wrappedUSDC强调
> - v2.1: 添加TokenBinding机制，更新Payload格式（支持跨链代币兑换）
> - v2.0: 聚焦宏观接口，添加模块间集成接口，移除原生代币支持

---

## 📋 目录

1. [项目概述](#1-项目概述)
2. [用户接口 - EVM合约](#2-用户接口---evm合约)
3. [用户接口 - Solana程序](#3-用户接口---solana程序)
4. [Guardian REST API - 对外观测接口](#4-guardian-rest-api---对外观测接口)
5. [Relayer REST API - 对外观测接口](#5-relayer-rest-api---对外观测接口)
6. [管理员接口](#6-管理员接口)
7. [模块间集成接口](#7-模块间集成接口)
8. [接口鉴权设计](#8-接口鉴权设计)
9. [数据结构定义](#9-数据结构定义)
10. [错误码规范](#10-错误码规范)

---

## 1. 项目概述

### 1.1 接口分类

| 接口类型 | 数量 | 调用方 | 说明 |
|---------|------|--------|------|
| **用户接口（合约）** | 8个 | 用户/Dapp | EVM/Solana合约公开函数 |
| **Guardian观测API** | 4个 | 用户/监控 | 查询VAA状态、Guardian健康 |
| **Relayer观测API** | 3个 | 用户/监控 | 查询中继任务状态 |
| **管理员接口** | 4个 | 治理多签 | Guardian升级、紧急暂停、速率限制、提取手续费 |
| **模块间集成接口** | 3类 | 内部模块 | 合约↔Guardian、Relayer↔Guardian、Relayer↔合约 |

**总计**: 19个用户/管理员接口 + 3类集成接口

---

### 1.2 支持的资产

| 资产类型 | 源链 | 目标链 | 模式 |
|---------|------|--------|------|
| **ERC20代币** | EVM | Solana | TokenBinding绑定 + Lock/Unlock或Mint/Burn |
| **SPL代币** | Solana | EVM | TokenBinding绑定 + Lock/Unlock或Mint/Burn |
| **测试代币** | USDC等 | 双向跨链 | 完整流程测试（通过TokenBinding） |

**不支持**: 原生ETH、原生SOL（简化设计）

---

### 1.3 系统参数

```yaml
# Guardian网络
GUARDIAN_COUNT: 19
SIGNATURE_QUORUM: 13  # 68%+

# 链支持（可配置）
supported_chains:
  - type: evm
    chain_id: 1
    name: "Ethereum"
  - type: evm
    chain_id: 56
    name: "BSC"
  - type: svm
    chain_id: 2
    name: "Solana"

# 限额
MAX_SINGLE_TRANSFER: 1000000 USD
DAILY_LIMIT: 10000000 USD
```

---

## 2. 用户接口 - EVM合约

### 2.1 BridgeCore.sol - 核心合约

#### 2.1.1 publishMessage

**功能**: 发送跨链消息

**接口**:
```solidity
function publishMessage(
    uint32 nonce,
    bytes memory payload,
    uint8 consistencyLevel
) external payable returns (uint64 sequence);
```

**参数**:
- `nonce`: 随机数（防重放，用户自定义）
- `payload`: 消息载荷（包含代币转账信息）
- `consistencyLevel`: 确认级别（200=最终确认）

**返回**: 消息序列号

**事件**:
```solidity
event LogMessagePublished(
    address indexed sender,
    uint64 sequence,
    uint32 nonce,
    bytes payload,
    uint8 consistencyLevel
);
```

**用途**: 锁定代币后调用此函数发送跨链消息

---

#### 2.1.2 receiveMessage

**功能**: 接收并执行跨链消息

**接口**:
```solidity
function receiveMessage(
    bytes memory encodedVAA
) external returns (bool success);
```

**参数**:
- `encodedVAA`: 经过Guardian签名的VAA字节数组

**流程**:
1. 验证VAA签名（13/19门限）
2. 检查VAA未被消费
3. 标记VAA已消费
4. 解析payload并执行操作

**事件**:
```solidity
event MessageReceived(
    bytes32 indexed vaaHash,
    uint16 sourceChain,
    uint64 sequence
);
```

---

#### 2.1.3 getCurrentGuardianSetIndex

**功能**: 查询当前Guardian Set版本

**接口**:
```solidity
function getCurrentGuardianSetIndex() 
    external view returns (uint32 index);
```

---

#### 2.1.4 isVAAConsumed

**功能**: 检查VAA是否已被消费

**接口**:
```solidity
function isVAAConsumed(bytes32 vaaHash) 
    external view returns (bool);
```

---

### 2.2 TokenVault.sol - 代币金库

#### 2.2.1 lockTokens

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
- `token`: ERC20代币地址
- `amount`: 转账数量
- `targetChainId`: 目标链ID（2=Solana）
- `recipient`: 接收者地址（32字节格式）

**流程**:
1. `transferFrom` 代币到Vault
2. 记录锁定余额
3. 构造payload
4. 调用 `BridgeCore.publishMessage()`

**事件**:
```solidity
event TokensLocked(
    bytes32 indexed transferId,
    address indexed token,
    uint256 amount,
    uint16 targetChain,
    bytes32 recipient
);
```

---

#### 2.2.2 unlockTokens

**功能**: 解锁代币（接收跨链转账）

**接口**:
```solidity
function unlockTokens(bytes memory vaa) 
    external returns (bool success);
```

**流程**:
1. 验证VAA
2. 解析payload获取(token, amount, recipient)
3. 检查锁定余额充足
4. `transfer` 代币给接收者

---

### 2.3 WrappedToken.sol - 包装代币

**概念说明**：
- 本项目使用 **TokenBinding机制** 而非传统的wrapped token模式
- TokenBinding = 源链代币与目标链代币的绑定映射关系
- 支持同币种跨链（USDC → USDC）和不同币种兑换（USDC → USDT）
- 注意：不支持原生ETH/SOL跨链，仅支持ERC20/SPL代币

**跨链模式**：
```
TokenBinding机制（灵活配置）:
  1. 注册TokenBinding: register_token_binding(sourceToken, targetToken, rate)
  2. 源链: 锁定源代币
  3. 目标链: 根据Binding配置解锁/铸造目标代币
  4. 支持多对多映射: 一个源代币可绑定多个目标代币
```

---

#### 2.3.1 registerTokenBinding

**功能**: 注册源链代币与目标链代币的绑定关系（取代createWrapped）

**接口**:
```solidity
function registerTokenBinding(
    uint16 sourceChain,
    bytes32 sourceToken,
    uint16 targetChain,
    bytes32 targetToken,
    uint64 rateNumerator,
    uint64 rateDenominator
) external returns (bytes32 bindingId);
```

**参数**:
- `sourceChain`: 源链ID
- `sourceToken`: 源链代币地址（32字节格式）
- `targetChain`: 目标链ID
- `targetToken`: 目标链代币地址（32字节格式）
- `rateNumerator/rateDenominator`: 兑换比率（如1:1或998:1000）

**使用场景**:
- 首次建立跨链代币映射关系时调用
- 支持同币种（USDC → USDC）和跨币种（USDC → USDT）
- 支持多对多：一个源代币可绑定多个目标代币

---

#### 2.3.2 mint

**功能**: 接收跨链转账时铸造wrappedToken

**接口**:
```solidity
function mint(address to, uint256 amount) 
    external onlyBridge;
```

**权限**: 只有Bridge合约可调用

---

#### 2.3.3 burn

**功能**: 跨链转回原链时销毁wrappedToken

**接口**:
```solidity
function burn(address from, uint256 amount) 
    external onlyBridge;
```

**权限**: 只有Bridge合约可调用

---

## 3. 用户接口 - Solana程序

### 3.1 solana-core - 核心程序

#### 3.1.1 post_message

**功能**: 发送跨链消息

**接口**:
```rust
pub fn post_message(
    ctx: Context<PostMessage>,
    nonce: u32,
    payload: Vec<u8>,
    consistency_level: u8,
) -> Result<()>
```

**账户**:
```rust
#[derive(Accounts)]
pub struct PostMessage<'info> {
    #[account(mut)]
    pub bridge: Account<'info, Bridge>,
    
    #[account(init, payer = payer, space = 8 + 1024)]
    pub message: Account<'info, PostedMessage>,
    
    pub emitter: Signer<'info>,
    
    #[account(mut)]
    pub sequence: Account<'info, Sequence>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}
```

---

#### 3.1.2 post_vaa

**功能**: 接收并验证VAA

**接口**:
```rust
pub fn post_vaa(
    ctx: Context<PostVAA>,
    vaa: Vec<u8>,
) -> Result<()>
```

**验证步骤**:
1. 解析VAA结构
2. 验证Guardian签名（使用secp256k1指令）
3. 检查未被消费
4. 存储到PostedVAA账户

---

### 3.2 token-bridge - 代币桥程序

#### 3.2.1 transfer_tokens

**功能**: 锁定SPL代币并发起跨链转账

**接口**:
```rust
pub fn transfer_tokens(
    ctx: Context<TransferTokens>,
    amount: u64,
    target_chain: u16,
    recipient: [u8; 32],
) -> Result<()>
```

---

#### 3.2.2 complete_transfer

**功能**: 完成跨链转账（解锁或铸造）

**接口**:
```rust
pub fn complete_transfer(
    ctx: Context<CompleteTransfer>,
    vaa: Vec<u8>,
) -> Result<()>
```

---

## 4. Guardian REST API - 对外观测接口

### 4.1 GET /v1/signed_vaa/{chain}/{emitter}/{sequence}

**功能**: 获取已签名的VAA

**请求**:
```http
GET /v1/signed_vaa/1/0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb/42
```

**响应**:
```json
{
  "vaaBytes": "0x01000000...",
  "vaa": {
    "version": 1,
    "guardianSetIndex": 0,
    "signatures": [
      {"index": 0, "signature": "0x..."},
      {"index": 1, "signature": "0x..."}
    ],
    "timestamp": 1699276800,
    "nonce": 0,
    "emitterChain": 1,
    "emitterAddress": "0x742d35...",
    "sequence": 42,
    "payload": "0xabcd..."
  }
}
```

**状态码**:
- `200`: VAA已就绪
- `202`: VAA正在聚合中（签名未达门限）
- `404`: 消息不存在

---

### 4.2 GET /v1/vaa/status/{chain}/{emitter}/{sequence}

**功能**: 查询VAA聚合状态

**响应**:
```json
{
  "messageId": "1/0x742d35.../42",
  "status": "aggregating",
  "signatureCount": 11,
  "requiredSignatures": 13,
  "progress": 0.846,
  "guardiansSigned": [0, 1, 2, 5, 7, 9, 10, 12, 14, 16, 18]
}
```

**状态枚举**:
- `pending`: 等待观察
- `aggregating`: 正在收集签名
- `ready`: VAA已就绪
- `consumed`: VAA已被消费

---

### 4.3 GET /v1/guardian/health

**功能**: Guardian节点健康检查

**响应**:
```json
{
  "status": "healthy",
  "guardianIndex": 1,
  "p2pPeers": 18,
  "watchers": {
    "ethereum": {"status": "connected", "latestBlock": 18500000},
    "solana": {"status": "connected", "latestSlot": 250000000}
  },
  "metrics": {
    "messagesSigned": 123456,
    "uptime": "45d 12h"
  }
}
```

---

### 4.4 GET /v1/guardian/metrics

**功能**: Prometheus指标（用于监控）

**响应格式**: Prometheus text format

```
# HELP bridge_messages_total Total messages processed
# TYPE bridge_messages_total counter
bridge_messages_total{chain="ethereum"} 123456

# HELP bridge_signature_duration_seconds Signature duration
# TYPE bridge_signature_duration_seconds histogram
bridge_signature_duration_seconds_bucket{le="0.1"} 1000
```

---

## 5. Relayer REST API - 对外观测接口

### 5.1 POST /v1/relayer/submit

**功能**: 提交VAA到目标链

**请求**:
```json
{
  "vaa": "0x0100000001...",
  "targetChain": 2,
  "gasPrice": "auto"
}
```

**响应**:
```json
{
  "taskId": "relay-task-123456",
  "status": "pending",
  "estimatedTime": "30s"
}
```

---

### 5.2 GET /v1/relayer/task/{taskId}

**功能**: 查询中继任务状态

**响应**:
```json
{
  "taskId": "relay-task-123456",
  "status": "completed",
  "vaaHash": "0x5678...",
  "targetChain": 2,
  "txHash": "3Xn8...",
  "submittedAt": "2025-11-08T12:30:00Z",
  "completedAt": "2025-11-08T12:30:45Z"
}
```

**状态枚举**:
- `pending`: 等待提交
- `submitting`: 正在提交
- `completed`: 已完成
- `failed`: 失败

---

### 5.3 GET /v1/relayer/health

**功能**: Relayer服务健康检查

**响应**:
```json
{
  "status": "healthy",
  "pendingTasks": 5,
  "successRate": 0.998,
  "avgProcessingTime": "30s"
}
```

---

## 6. 管理员接口

### 6.1 updateGuardianSet - 升级Guardian Set

**EVM接口**:
```solidity
function updateGuardianSet(bytes memory vaa) 
    external;
```

**Solana接口**:
```rust
pub fn update_guardian_set(
    ctx: Context<UpdateGuardianSet>,
    vaa: Vec<u8>,
) -> Result<()>
```

**VAA Payload格式**:
```solidity
struct GuardianSetUpgrade {
    uint8 module;  // 0x01 (Core)
    uint8 action;  // 0x02 (GuardianSetUpgrade)
    uint16 chain;  // 0 (all chains)
    uint32 newGuardianSetIndex;
    address[] newGuardianKeys;
}
```

**原子性保证**:
- 两条链的升级VAA由相同的Guardian Set签名
- 新旧Set有7天过渡期
- 过渡期内新旧Set都有效

---

### 6.2 setPaused - 紧急暂停

**EVM接口**:
```solidity
function setPaused(bool paused) 
    external onlyGovernance;
```

**说明**: 暂停所有跨链操作，仅治理多签可调用

---

### 6.3 setRateLimit - 设置速率限制

**EVM接口**:
```solidity
function setRateLimit(
    uint256 maxPerTransaction,
    uint256 maxPerDay
) external onlyGovernance;
```

---

### 6.4 withdrawFees - 提取手续费

**功能**: 从合约中提取累积的跨链手续费

**EVM接口**:
```solidity
function withdrawFees(
    address recipient,
    uint256 amount
) external onlyGovernance;
```

**Solana接口**:
```rust
pub fn withdraw_fees(
    ctx: Context<WithdrawFees>,
    amount: u64,
) -> Result<()>
```

**参数**:
- `recipient`: 接收地址（治理多签地址）
- `amount`: 提取数量（0表示全部提取）

**权限**: 只有Governance多签可调用

**安全限制**:
- ✅ 需要治理多签授权
- ✅ 提取记录链上可查
- ✅ 发出WithdrawFees事件

**事件**:
```solidity
event FeesWithdrawn(
    address indexed recipient,
    uint256 amount,
    uint256 timestamp
);
```

---

## 7. 模块间集成接口

### 7.1 合约 → Guardian：事件监听接口

Guardian通过监听链上事件来获取跨链消息：

#### 7.1.1 EVM事件定义

**LogMessagePublished**:
```solidity
event LogMessagePublished(
    address indexed sender,      // 发送者地址
    uint64 sequence,             // 消息序列号
    uint32 nonce,                // 随机数
    bytes payload,               // 消息载荷
    uint8 consistencyLevel       // 确认级别
);
```

**Guardian监听逻辑**:
```rust
// Guardian的EVM Watcher
async fn watch_log_message_published() {
    let event_filter = contract.event::<LogMessagePublished>();
    let mut stream = event_filter.subscribe().await;
    
    while let Some(event) = stream.next().await {
        // 等待足够确认块
        wait_for_confirmations(event.block_number, 64).await;
        
        // 构造观察
        let observation = Observation {
            tx_hash: event.transaction_hash,
            block_number: event.block_number,
            emitter_chain: 1,  // Ethereum
            emitter_address: event.sender,
            sequence: event.sequence,
            nonce: event.nonce,
            payload: event.payload,
            consistency_level: event.consistency_level,
            timestamp: event.block_timestamp,
        };
        
        // 签名并广播
        let signature = sign_observation(&observation);
        broadcast_to_p2p(observation, signature).await;
    }
}
```

---

#### 7.1.2 Solana事件监听

**Solana Transaction Log格式**:
```rust
// Solana程序发出的日志
pub fn emit_message_published(
    emitter: Pubkey,
    sequence: u64,
    nonce: u32,
    payload: Vec<u8>,
    consistency_level: u8,
) {
    msg!(
        "MessagePublished: emitter={}, sequence={}, nonce={}, consistency_level={}, payload={}",
        emitter, sequence, nonce, consistency_level, hex::encode(&payload)
    );
}
```

**Guardian监听逻辑**:
```rust
// Guardian的Solana Watcher
async fn watch_solana_transactions() {
    // 订阅程序账户变化
    let subscription = rpc_client.account_subscribe(
        &bridge_program_id,
        Some(commitment_config)
    ).await;
    
    while let Some(update) = subscription.next().await {
        // 解析交易日志
        let logs = parse_transaction_logs(&update);
        
        for log in logs {
            if log.contains("MessagePublished") {
                let observation = parse_message_published_log(&log);
                
                // 签名并广播
                let signature = sign_observation(&observation);
                broadcast_to_p2p(observation, signature).await;
            }
        }
    }
}
```

---

#### 7.1.3 Payload解析与验证（Guardian）

**重要**: Guardian不验证TokenBinding，只签名原始消息

```rust
// Guardian处理流程
async fn process_observation(observation: Observation) -> Result<()> {
    // 1. 验证Payload长度
    let payload_length = observation.payload.len();
    if payload_length != 157 {
        return Err(Error::InvalidPayloadLength {
            expected: 157,
            actual: payload_length,
        });
    }
    
    // 2. 签名原始消息（不关心业务逻辑）
    let message_hash = keccak256(&observation.payload);
    let signature = sign_with_guardian_key(message_hash)?;
    
    // 3. 广播到P2P网络
    broadcast_signature(observation.id, signature).await?;
    
    Ok(())
}
```

**关键点**:
- ✅ Guardian只验证消息格式，不验证TokenBinding是否存在
- ✅ Guardian只接受标准Payload长度（157字节）
- ✅ TokenBinding验证由目标链合约/程序执行
- ✅ 这保证了Guardian的通用性和简洁性

---

### 7.2 Relayer → Guardian：VAA获取接口

Relayer从Guardian API获取已签名的VAA：

**接口**: `GET /v1/signed_vaa/{chain}/{emitter}/{sequence}`

**数据流**:
```
1. Relayer监听源链事件（可选，也可由用户/监控触发）
2. Relayer轮询Guardian API获取VAA
3. 如果返回202（聚合中），继续轮询
4. 如果返回200（已就绪），获取VAA字节数组
5. Relayer提交VAA到目标链
```

**Relayer实现示例**:
```rust
pub async fn fetch_vaa(
    &self,
    chain_id: u16,
    emitter: &str,
    sequence: u64,
) -> Result<Vec<u8>> {
    let url = format!(
        "{}/v1/signed_vaa/{}/{}/{}",
        self.guardian_url, chain_id, emitter, sequence
    );
    
    // 轮询直到VAA就绪（最多5分钟）
    for _ in 0..60 {
        let response = self.client.get(&url).send().await?;
        
        match response.status().as_u16() {
            200 => {
                let body: VAAResponse = response.json().await?;
                return Ok(hex::decode(&body.vaa_bytes[2..])?);
            }
            202 => {
                // VAA正在聚合，等待5秒后重试
                tokio::time::sleep(Duration::from_secs(5)).await;
                continue;
            }
            404 => {
                return Err(Error::VAANotFound);
            }
            _ => {
                return Err(Error::GuardianAPIError);
            }
        }
    }
    
    Err(Error::VAATimeout)
}
```

---

### 7.3 Relayer → 合约：交易提交接口

Relayer调用目标链合约提交VAA：

#### 7.3.1 提交到EVM链

**接口**: `BridgeCore.receiveMessage(bytes memory encodedVAA)`

**Relayer实现**:
```rust
pub async fn submit_to_evm(
    &self,
    chain_id: u16,
    vaa: Vec<u8>,
) -> Result<TransactionReceipt> {
    let bridge_core = self.get_bridge_contract(chain_id);
    
    // 估算Gas
    let gas_estimate = bridge_core
        .receive_message(vaa.clone().into())
        .estimate_gas()
        .await?;
    
    // 提交交易
    let tx = bridge_core
        .receive_message(vaa.into())
        .gas(gas_estimate * 120 / 100)  // 加20%余量
        .send()
        .await?;
    
    // 等待确认
    let receipt = tx.await?;
    
    Ok(receipt)
}
```

---

#### 7.3.2 提交到Solana链

**接口**: `solana_core::post_vaa(vaa: Vec<u8>)`

**Relayer实现**:
```rust
pub async fn submit_to_solana(
    &self,
    vaa: Vec<u8>,
) -> Result<Signature> {
    let program = self.get_solana_program();
    
    // 构造交易
    let tx = program.methods()
        .post_vaa(vaa)
        .accounts({
            guardian_set: guardian_set_pda,
            posted_vaa: posted_vaa_pda,
            payer: self.payer.pubkey(),
            system_program: system_program::ID,
        })
        .signer(&self.payer)
        .rpc()
        .await?;
    
    Ok(tx)
}
```

---

#### 7.3.3 目标链TokenBinding验证流程

**重要**: TokenBinding验证在目标链的unlockTokens/complete_transfer中执行

**EVM链验证流程**:
```solidity
// TokenVault.unlockTokens
function unlockTokens(bytes memory vaa) external returns (bool) {
    // 1. 验证VAA签名（BridgeCore）
    bool valid = bridgeCore.receiveMessage(vaa);
    require(valid, "Invalid VAA");
    
    // 2. 解析Payload
    TokenTransferPayload memory payload = parsePayload(vaa);
    
    // 3. 查询TokenBinding（关键步骤）
    bytes32 bindingKey = keccak256(abi.encodePacked(
        payload.tokenChain,
        payload.tokenAddress,
        payload.recipientChain,
        payload.targetToken
    ));
    TokenBinding storage binding = tokenBindings[bindingKey];
    
    // 4. 验证TokenBinding存在且已启用
    require(binding.enabled, "TokenBinding not enabled");
    
    // 5. 验证兑换比率一致性（防篡改）
    uint256 expectedAmount = payload.amount 
        * binding.rateNumerator 
        / binding.rateDenominator;
    require(
        payload.targetAmount == expectedAmount,
        "Exchange rate mismatch"
    );
    
    // 6. 验证目标代币匹配
    require(
        payload.targetToken == bytes32(uint256(uint160(binding.targetToken))),
        "Target token mismatch"
    );
    
    // 7. 解锁代币
    IERC20(binding.targetToken).transfer(
        address(uint160(uint256(payload.recipient))),
        payload.targetAmount
    );
    
    return true;
}
```

**Solana链验证流程**:
```rust
// token_bridge::complete_transfer
pub fn complete_transfer(
    ctx: Context<CompleteTransfer>,
    vaa: Vec<u8>,
) -> Result<()> {
    // 1. 验证VAA（solana-core）
    solana_core::cpi::post_vaa(ctx.accounts.as_post_vaa_context(), vaa)?;
    
    // 2. 解析Payload
    let payload = TokenTransferPayload::try_from_slice(&posted_vaa.payload)?;
    
    // 3. 查询TokenBinding（使用PDA）
    let binding_seeds = [
        b"TokenBinding",
        &payload.token_chain.to_le_bytes(),
        payload.token_address.as_ref(),
        &payload.recipient_chain.to_le_bytes(),
        payload.target_token.as_ref(),
    ];
    // ctx.accounts.token_binding验证PDA匹配
    
    // 4. 验证TokenBinding已启用
    require!(
        ctx.accounts.token_binding.enabled,
        TokenBridgeError::TokenBindingNotEnabled
    );
    
    // 5. 验证兑换比率一致性
    let expected_amount = payload.amount
        .checked_mul(ctx.accounts.token_binding.rate_numerator)
        .unwrap()
        .checked_div(ctx.accounts.token_binding.rate_denominator)
        .unwrap();
    require!(
        payload.target_amount == expected_amount,
        TokenBridgeError::InvalidExchangeRate
    );
    
    // 6. 验证目标代币Mint匹配
    require!(
        ctx.accounts.target_token_mint.key() == Pubkey::from(payload.target_token),
        TokenBridgeError::TargetTokenMismatch
    );
    
    // 7. 转账代币
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.custody_account.to_account_info(),
                to: ctx.accounts.recipient_account.to_account_info(),
                authority: ctx.accounts.custody_authority.to_account_info(),
            },
        ),
        payload.target_amount,
    )?;
    
    Ok(())
}
```

**关键验证点总结**:
1. ✅ **VAA签名验证**（Guardian共识）
2. ✅ **TokenBinding存在性检查**（映射关系已注册）
3. ✅ **TokenBinding启用状态**（管理员可以禁用某些映射）
4. ✅ **兑换比率一致性**（防止VAA中的比率被篡改）
5. ✅ **目标代币匹配**（确保转账到正确的代币）
6. ✅ **余额充足性**（custody账户有足够代币）

---

### 7.4 Guardian间P2P通信接口

**协议**: libp2p Gossipsub

**消息类型**:

#### 7.4.1 Observation消息

```rust
#[derive(Serialize, Deserialize)]
pub struct ObservationMessage {
    pub message_hash: [u8; 32],
    pub emitter_chain: u16,
    pub emitter_address: [u8; 32],
    pub sequence: u64,
    pub payload: Vec<u8>,
    pub timestamp: u32,
    pub nonce: u32,
}
```

**用途**: Guardian观察到新消息后广播

---

#### 7.4.2 Signature消息

```rust
#[derive(Serialize, Deserialize)]
pub struct SignatureMessage {
    pub message_hash: [u8; 32],
    pub guardian_index: u8,
    pub signature: [u8; 65],  // ECDSA签名 (r, s, v)
}
```

**用途**: Guardian对消息签名后广播

---

#### 7.4.3 VAA Ready消息

```rust
#[derive(Serialize, Deserialize)]
pub struct VAAReadyMessage {
    pub message_hash: [u8; 32],
    pub vaa: Vec<u8>,
}
```

**用途**: 签名达到门限后广播VAA就绪

---

## 8. 接口鉴权设计

### 8.1 公开接口（无需鉴权）

- ✅ 所有合约函数（链上验证）
- ✅ Guardian GET接口（查询VAA、状态）
- ✅ Relayer GET接口（查询任务状态）

---

### 8.2 需要鉴权的接口

#### 8.2.1 Guardian管理接口

**接口**: `POST /v1/admin/*`

**鉴权方式**: Bearer Token + IP白名单

```http
POST /v1/admin/guardian/sign
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
X-Admin-IP: 192.168.1.100
```

**Token生成**:
```rust
// 使用HMAC-SHA256签名
let secret = env::var("ADMIN_SECRET")?;
let token = jwt::encode(
    &Header::default(),
    &Claims { sub: "admin", exp: timestamp + 3600 },
    &EncodingKey::from_secret(secret.as_bytes())
)?;
```

**验证逻辑**:
```rust
pub async fn verify_admin_token(
    token: &str,
    ip: &str,
) -> Result<bool> {
    // 1. 验证JWT签名
    let claims = jwt::decode::<Claims>(
        token,
        &DecodingKey::from_secret(SECRET.as_bytes()),
        &Validation::default()
    )?;
    
    // 2. 检查IP白名单
    if !ADMIN_IPS.contains(&ip) {
        return Err(Error::Unauthorized);
    }
    
    // 3. 检查过期时间
    if claims.exp < now() {
        return Err(Error::TokenExpired);
    }
    
    Ok(true)
}
```

---

#### 8.2.2 合约管理员函数

**鉴权方式**: Solidity modifier

```solidity
address public governance;

modifier onlyGovernance() {
    require(msg.sender == governance, "Not governance");
    _;
}

function updateGuardianSet(bytes memory vaa) 
    external onlyGovernance {
    // ...
}

function setPaused(bool paused) 
    external onlyGovernance {
    // ...
}

function setRateLimit(uint256 maxPerTx, uint256 maxPerDay)
    external onlyGovernance {
    // ...
}

function withdrawFees(address recipient, uint256 amount)
    external onlyGovernance {
    // ...
}
```

**Governance地址**: 多签钱包（如Gnosis Safe）

**管理员接口列表**:
1. ✅ `updateGuardianSet` - 升级Guardian Set
2. ✅ `setPaused` - 紧急暂停/恢复
3. ✅ `setRateLimit` - 调整速率限制
4. ✅ `withdrawFees` - 提取手续费（需鉴权）

---

#### 8.2.3 Relayer提交接口

**鉴权方式**: 无需鉴权（任何人可调用，合约会验证VAA）

**Gas费支付**: Relayer自行支付，可选择收取手续费

---

## 9. 数据结构定义

### 9.1 VAA结构

```rust
pub struct VAA {
    // Header
    pub version: u8,
    pub guardian_set_index: u32,
    
    // Signatures
    pub signatures: Vec<Signature>,
    
    // Body
    pub timestamp: u32,
    pub nonce: u32,
    pub emitter_chain: u16,
    pub emitter_address: [u8; 32],
    pub sequence: u64,
    pub consistency_level: u8,
    pub payload: Vec<u8>,
}

pub struct Signature {
    pub guardian_index: u8,
    pub r: [u8; 32],
    pub s: [u8; 32],
    pub v: u8,
}
```

**序列化格式**:
```
[version:1][guardian_set_index:4][signatures_len:1]
[signatures:66*N]
[timestamp:4][nonce:4][emitter_chain:2][emitter_address:32]
[sequence:8][consistency_level:1][payload:*]
```

---

### 9.2 Token Transfer Payload

**功能**: 支持跨链代币兑换和TokenBinding验证

```solidity
struct TokenTransferPayload {
    uint8 payloadType;          // 1 = token transfer with exchange
    uint256 amount;             // 源链锁定数量
    bytes32 tokenAddress;       // 源链代币地址（32字节）
    uint16 tokenChain;          // 源链ID
    bytes32 recipient;          // 接收者地址
    uint16 recipientChain;      // 目标链ID
    bytes32 targetToken;        // 目标链代币地址（用户选择）
    uint64 targetAmount;        // 目标链接收数量（计算后）
    uint64 exchangeRateNum;     // 兑换比率分子
    uint64 exchangeRateDenom;   // 兑换比率分母
}
```

**字节布局**:
```
Offset  Size  Field
------  ----  -----
0       1     payloadType
1       32    amount (uint256, big-endian)
33      32    tokenAddress
65      2     tokenChain (uint16, big-endian)
67      32    recipient
99      2     recipientChain (uint16, big-endian)
101     32    targetToken
133     8     targetAmount (uint64, big-endian)
141     8     exchangeRateNum (uint64, big-endian)
149     8     exchangeRateDenom (uint64, big-endian)
------
总计: 157字节
```

**编码示例**:
```solidity
// 示例1: USDC → USDC (同币种兑换，1:1)
bytes memory payload = abi.encodePacked(
    uint8(1),                      // payloadType
    uint256(1000e6),               // amount: 1000 USDC
    bytes32(uint256(uint160(sourceToken))),  // tokenAddress
    uint16(1),                     // tokenChain: Ethereum
    recipientBytes32,              // recipient
    uint16(900),                   // recipientChain: Solana
    bytes32(uint256(uint160(targetToken))),  // targetToken: Solana USDC
    uint64(1000e6),                // targetAmount: 1000 USDC
    uint64(1),                     // exchangeRateNum
    uint64(1)                      // exchangeRateDenom
);

// 示例2: USDC → USDT (不同币种兑换，998:1000)
bytes memory payload = abi.encodePacked(
    uint8(1),
    uint256(1000e6),               // amount: 1000 USDC
    bytes32(uint256(uint160(usdcAddress))),
    uint16(1),                     // Ethereum
    recipientBytes32,
    uint16(900),                   // Solana
    bytes32(uint256(uint160(usdtAddress))),  // targetToken: USDT
    uint64(998e6),                 // targetAmount: 998 USDT (兑换后)
    uint64(998),                   // exchangeRateNum
    uint64(1000)                   // exchangeRateDenom
);
```

---

### 9.2.3 TokenBinding数据结构

**功能**: 存储代币跨链映射关系和兑换配置

**EVM实现**:
```solidity
struct TokenBinding {
    uint16 sourceChain;          // 源链ID
    bytes32 sourceToken;         // 源链代币地址（32字节）
    uint16 targetChain;          // 目标链ID
    bytes32 targetToken;         // 目标链代币地址（32字节）
    uint64 rateNumerator;        // 兑换比率分子
    uint64 rateDenominator;      // 兑换比率分母
    bool enabled;                // 是否启用
    uint256 createdAt;           // 创建时间
}

// 存储：支持多对多映射
// mapping: keccak256(sourceChain, sourceToken, targetChain, targetToken) => TokenBinding
mapping(bytes32 => TokenBinding) public tokenBindings;
```

**Solana实现**:
```rust
#[account]
pub struct TokenBinding {
    pub source_chain: u16,
    pub source_token: [u8; 32],
    pub target_chain: u16,
    pub target_token: [u8; 32],
    pub rate_numerator: u64,
    pub rate_denominator: u64,
    pub use_external_price: bool,    // 预留：AMM动态定价
    pub amm_program_id: Pubkey,       // 预留：外部AMM程序
    pub enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
}
```

**PDA推导（Solana）**:
```rust
let (token_binding_pda, _) = Pubkey::find_program_address(
    &[
        b"TokenBinding",
        source_chain.to_le_bytes().as_ref(),
        source_token.as_ref(),
        target_chain.to_le_bytes().as_ref(),
        target_token.as_ref(),  // 支持多对多
    ],
    program_id
);
```

**多对多关系示例**:
```
Ethereum USDC (Chain 1) 可以绑定到：
  → [1, eth_usdc, 900, sol_usdc]    rate=1:1        (Solana USDC)
  → [1, eth_usdc, 900, sol_usdt]    rate=998:1000   (Solana USDT)
  → [1, eth_usdc, 56, bsc_busd]     rate=999:1000   (BSC BUSD)
  → [1, eth_usdc, 137, poly_usdc]   rate=1:1        (Polygon USDC)

用户转账时通过targetToken参数选择目标代币
```

---

### 9.3 Guardian Set结构

```rust
pub struct GuardianSet {
    pub index: u32,
    pub keys: Vec<[u8; 20]>,  // Ethereum地址格式
    pub creation_time: i64,
    pub expiration_time: u32,  // 0 = active
}
```

---

### 9.4 链配置结构

```rust
pub struct ChainConfig {
    pub chain_id: u16,
    pub chain_type: ChainType,  // EVM or SVM
    pub name: String,
    pub rpc_url: String,
    pub core_address: String,   // 合约/程序地址
    pub confirmations: u64,     // 确认块数
}

pub enum ChainType {
    EVM,
    SVM,
}
```

---

## 10. 错误码规范

### 10.1 HTTP API错误码

| 状态码 | 说明 |
|-------|------|
| 200 | 成功 |
| 202 | 接受（VAA聚合中） |
| 400 | 请求参数错误 |
| 401 | 未授权 |
| 404 | 资源不存在 |
| 500 | 服务器内部错误 |
| 503 | 服务不可用 |

---

### 10.2 合约错误码

**EVM**:
```solidity
error InsufficientFee();
error InvalidVAA();
error VAAAlreadyConsumed();
error InvalidGuardianSet();
error InsufficientSignatures();
error InvalidSignature();
error ExceedsRateLimit();
error BridgePaused();
```

**Solana**:
```rust
#[error_code]
pub enum BridgeError {
    #[msg("Invalid VAA")]
    InvalidVAA,
    
    #[msg("VAA already consumed")]
    VAAAlreadyConsumed,
    
    #[msg("Insufficient signatures")]
    InsufficientSignatures,
    
    #[msg("Invalid guardian set")]
    InvalidGuardianSet,
}
```

---

### 10.3 Guardian API错误码

```json
{
  "error": {
    "code": "VAA_NOT_FOUND",
    "message": "VAA not found for chain=1, emitter=0x..., sequence=42"
  }
}
```

**错误码列表**:
- `VAA_NOT_FOUND`: VAA不存在
- `VAA_AGGREGATING`: VAA正在聚合
- `INVALID_PARAMETERS`: 参数错误
- `INTERNAL_ERROR`: 内部错误

---

## 附录

### A. TokenBinding跨链测试场景

**测试流程**（基于TokenBinding机制）:

```
1. 准备阶段
   - 在Ethereum部署USDC合约（测试币）
   - 在Solana部署目标代币（可以是USDC或USDT等）
   - 注册TokenBinding: register_token_binding(eth_usdc, sol_usdc, 1, 1)
   - 用户在Ethereum持有1000 USDC

2. Ethereum → Solana（跨链转账）
   - 用户调用TokenVault.lockTokens(USDC, 1000, targetChain, targetToken, recipient)
   - Guardian监听事件并签名
   - Relayer获取VAA并提交到Solana
   - Solana根据TokenBinding验证并解锁/铸造目标代币
   - 用户在Solana收到1000目标代币（按兑换比率）

3. Solana → Ethereum（反向跨链）
   - 用户调用token_bridge.transfer_tokens(sourceToken, amount, targetChain, targetToken, recipient)
   - Guardian监听并签名
   - Relayer提交VAA到Ethereum
   - Ethereum根据TokenBinding验证并解锁源代币
   - 用户收到相应数量的源代币

4. 验证
   - TokenBinding匹配验证
   - 兑换比率正确性验证
   - 余额检查
   - 事件日志验证
   - VAA状态验证
```

---

### B. Chain ID表

| Chain ID | 链名称 | 类型 |
|---------|-------|------|
| 1 | Ethereum | EVM |
| 2 | Solana | SVM |
| 56 | BSC | EVM |
| 137 | Polygon | EVM |

---

**文档状态**: ✅ v2.0 已完成  
**下一步**: 更新TEST-PLAN.md

