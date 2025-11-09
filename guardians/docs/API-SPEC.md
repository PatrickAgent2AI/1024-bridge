# Guardian 模块 - API规格说明书

> **文档版本**: v1.0  
> **创建日期**: 2025-11-09  
> **子模块**: guardians  
> **父模块**: newlife 跨链桥项目

---

## 📋 目录

1. [模块概述](#1-模块概述)
2. [对外REST API](#2-对外rest-api)
3. [模块间集成接口](#3-模块间集成接口)
4. [管理接口](#4-管理接口)
5. [接口鉴权设计](#5-接口鉴权设计)
6. [数据结构定义](#6-数据结构定义)
7. [错误码规范](#7-错误码规范)
8. [配置接口](#8-配置接口)

---

## 1. 模块概述

### 1.1 Guardian 模块职责

Guardian 是跨链桥的核心验证层,负责:

```
┌─────────────────────────────────────────────────────────────┐
│                    Guardian 核心功能                          │
│                                                               │
│  1. 链监听 (Watcher)                                          │
│     - 监听源链的 LogMessagePublished 事件                     │
│     - 等待足够的确认块数                                       │
│     - 构造观察记录 (Observation)                               │
│                                                               │
│  2. 签名生成 (Signer)                                         │
│     - 对观察记录进行 ECDSA 签名                                │
│     - 使用 Guardian 私钥签名                                   │
│     - 生成签名消息                                             │
│                                                               │
│  3. P2P 通信                                                  │
│     - 通过 libp2p 广播签名                                    │
│     - 接收其他 Guardian 的签名                                 │
│     - Gossipsub 协议进行消息传播                              │
│                                                               │
│  4. 签名聚合 (Aggregator)                                     │
│     - 收集来自不同 Guardian 的签名                             │
│     - 验证签名有效性                                           │
│     - 达到 13/19 门限后构造 VAA                                │
│                                                               │
│  5. VAA 存储与查询                                            │
│     - 将完整 VAA 存储到 PostgreSQL                            │
│     - 提供 REST API 供 Relayer 查询                           │
│     - Redis 缓存热点数据                                       │
└─────────────────────────────────────────────────────────────┘
```

---

### 1.2 接口分类

| 接口类型 | 数量 | 调用方 | 说明 |
|---------|------|--------|------|
| **对外观测API** | 4个 | 用户/监控/Relayer | 查询VAA、状态、健康检查 |
| **管理接口** | 2个 | 管理员 | 手动触发签名、配置管理 |
| **输入集成接口** | 2类 | 合约事件 | 监听链上事件 |
| **输出集成接口** | 1类 | Relayer | 提供VAA供中继 |
| **P2P接口** | 3类 | Guardian网络 | 内部通信 |

---

### 1.3 系统参数

```yaml
# Guardian 网络配置
GUARDIAN_COUNT: 19
SIGNATURE_QUORUM: 13  # 68%+
GUARDIAN_SET_INDEX: 0  # 初始版本

# 链监听配置
EVM_CONFIRMATIONS: 64  # Ethereum 确认块数
SOLANA_CONFIRMATIONS: 32  # Solana 确认块数

# P2P 配置
P2P_PORT: 8999
P2P_BOOTSTRAP_PEERS: 5  # 引导节点数量

# API 配置
REST_API_PORT: 7071
PROMETHEUS_PORT: 9090

# 存储配置
POSTGRES_MAX_CONNECTIONS: 100
REDIS_CACHE_TTL: 3600  # 1小时
```

---

## 2. 对外REST API

### 2.1 GET /v1/signed_vaa/{chain}/{emitter}/{sequence}

**功能**: 获取已签名的VAA

**路径参数**:
- `chain`: 源链ID (例如: 1=Ethereum, 2=Solana)
- `emitter`: 发送者地址 (32字节十六进制)
- `sequence`: 消息序列号

**请求示例**:
```http
GET /v1/signed_vaa/1/0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb/42
```

**响应 200 (VAA已就绪)**:
```json
{
  "vaaBytes": "0x01000000010d...",
  "vaa": {
    "version": 1,
    "guardianSetIndex": 0,
    "signatures": [
      {"index": 0, "signature": "0x1a2b3c..."},
      {"index": 1, "signature": "0x4d5e6f..."},
      {"index": 5, "signature": "0x7g8h9i..."}
    ],
    "timestamp": 1699276800,
    "nonce": 0,
    "emitterChain": 1,
    "emitterAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
    "sequence": 42,
    "consistencyLevel": 200,
    "payload": "0xabcdef..."
  }
}
```

**响应 202 (VAA聚合中)**:
```json
{
  "status": "aggregating",
  "message": "Waiting for more signatures",
  "progress": {
    "current": 11,
    "required": 13,
    "percentage": 0.846
  }
}
```

**响应 404 (消息不存在)**:
```json
{
  "error": {
    "code": "VAA_NOT_FOUND",
    "message": "No message found for chain=1, emitter=0x742d35..., sequence=42"
  }
}
```

**实现要点**:
- 首先查询 PostgreSQL 中的 VAA 记录
- 如果VAA已完成(签名≥13),直接返回
- 如果VAA正在聚合中(签名<13),返回202和当前进度
- 如果消息不存在,检查链监听器是否观察到该消息
- 使用 Redis 缓存已完成的 VAA (TTL=1小时)

---

### 2.2 GET /v1/vaa/status/{chain}/{emitter}/{sequence}

**功能**: 查询VAA聚合状态和进度

**路径参数**: 同2.1

**请求示例**:
```http
GET /v1/vaa/status/1/0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb/42
```

**响应**:
```json
{
  "messageId": "1/0x742d35.../42",
  "status": "aggregating",
  "signatureCount": 11,
  "requiredSignatures": 13,
  "progress": 0.846,
  "guardiansSigned": [0, 1, 2, 5, 7, 9, 10, 12, 14, 16, 18],
  "guardiansNotSigned": [3, 4, 6, 8, 11, 13, 15, 17],
  "estimatedCompletionTime": "2025-11-09T10:15:30Z",
  "firstSignatureAt": "2025-11-09T10:14:00Z",
  "lastSignatureAt": "2025-11-09T10:14:45Z"
}
```

**状态枚举**:
- `pending`: 消息已观察到,等待第一个签名
- `aggregating`: 正在收集签名 (1-12个签名)
- `ready`: VAA已就绪 (≥13个签名)
- `consumed`: VAA已被目标链消费

**实现要点**:
- 查询 `signatures` 表统计签名数量
- 计算签名进度百分比
- 列出已签名和未签名的 Guardian 索引
- 根据最近签名速度估算完成时间

---

### 2.3 GET /v1/guardian/health

**功能**: Guardian节点健康检查

**请求示例**:
```http
GET /v1/guardian/health
```

**响应 200 (健康)**:
```json
{
  "status": "healthy",
  "guardianIndex": 1,
  "guardianAddress": "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
  "p2p": {
    "status": "connected",
    "peers": 18,
    "topics": ["observations", "signatures", "vaa_ready"]
  },
  "watchers": {
    "ethereum": {
      "status": "connected",
      "latestBlock": 18500000,
      "lastEventAt": "2025-11-09T10:15:00Z",
      "lag": 2
    },
    "solana": {
      "status": "connected",
      "latestSlot": 250000000,
      "lastEventAt": "2025-11-09T10:14:58Z",
      "lag": 1
    }
  },
  "signer": {
    "status": "active",
    "totalSigned": 123456,
    "lastSignedAt": "2025-11-09T10:14:50Z"
  },
  "database": {
    "postgres": "connected",
    "redis": "connected"
  },
  "metrics": {
    "messagesSigned": 123456,
    "vaasAggregated": 123400,
    "averageAggregationTime": "25s",
    "uptime": "45d 12h 30m"
  }
}
```

**响应 503 (不健康)**:
```json
{
  "status": "unhealthy",
  "guardianIndex": 1,
  "issues": [
    {
      "component": "watcher_ethereum",
      "severity": "critical",
      "message": "RPC connection failed",
      "since": "2025-11-09T10:10:00Z"
    },
    {
      "component": "p2p",
      "severity": "warning",
      "message": "Peer count low (5/18)",
      "since": "2025-11-09T10:12:00Z"
    }
  ]
}
```

**健康检查项**:
- ✅ P2P网络连接状态
- ✅ 链监听器RPC连接
- ✅ 数据库连接
- ✅ 签名功能正常
- ✅ 最近活动时间

---

### 2.4 GET /v1/guardian/metrics

**功能**: Prometheus监控指标

**请求示例**:
```http
GET /v1/guardian/metrics
```

**响应格式**: Prometheus text format

**指标列表**:
```prometheus
# Guardian 网络指标
guardian_p2p_peers_total 18
guardian_p2p_messages_sent_total{type="observation"} 50000
guardian_p2p_messages_received_total{type="signature"} 950000

# 链监听器指标
guardian_watcher_latest_block{chain="ethereum"} 18500000
guardian_watcher_events_observed_total{chain="ethereum"} 123456
guardian_watcher_rpc_errors_total{chain="ethereum"} 5

# 签名指标
guardian_signatures_generated_total 123456
guardian_signature_duration_seconds{quantile="0.5"} 0.05
guardian_signature_duration_seconds{quantile="0.99"} 0.15

# VAA聚合指标
guardian_vaas_aggregated_total 123400
guardian_vaa_aggregation_duration_seconds{quantile="0.5"} 25
guardian_vaa_aggregation_duration_seconds{quantile="0.99"} 45

# 数据库指标
guardian_db_queries_total{operation="insert"} 246800
guardian_db_query_duration_seconds{operation="select",quantile="0.99"} 0.02

# 系统指标
guardian_uptime_seconds 3926400
guardian_memory_usage_bytes 524288000
```

**用途**:
- Grafana可视化监控面板
- Prometheus告警规则配置
- 性能分析和优化

---

## 3. 模块间集成接口

### 3.1 输入接口: 监听链上事件

Guardian通过监听链上事件来获取跨链消息。

#### 3.1.1 监听 EVM LogMessagePublished 事件

**事件定义** (来自 BridgeCore.sol):
```solidity
event LogMessagePublished(
    address indexed sender,      // 发送者地址
    uint64 sequence,             // 消息序列号
    uint32 nonce,                // 随机数
    bytes payload,               // 消息载荷
    uint8 consistencyLevel       // 确认级别
);
```

**Guardian 监听逻辑**:
```rust
pub async fn watch_evm_events(chain_config: ChainConfig) -> Result<()> {
    let provider = Provider::<Http>::try_from(&chain_config.rpc_url)?;
    let contract = BridgeCore::new(chain_config.core_address, Arc::new(provider));
    
    // 创建事件过滤器
    let event_filter = contract
        .event::<LogMessagePublished>()
        .from_block(chain_config.start_block);
    
    let mut stream = event_filter.subscribe().await?;
    
    while let Some(Ok(event)) = stream.next().await {
        // 1. 等待足够的确认块数
        wait_for_confirmations(
            event.block_number,
            chain_config.confirmations
        ).await?;
        
        // 2. 构造观察记录
        let observation = Observation {
            tx_hash: event.transaction_hash,
            block_number: event.block_number,
            block_timestamp: get_block_timestamp(event.block_number).await?,
            emitter_chain: chain_config.chain_id,
            emitter_address: to_32_bytes(event.sender),
            sequence: event.sequence,
            nonce: event.nonce,
            payload: event.payload,
            consistency_level: event.consistency_level,
        };
        
        // 3. 对观察记录签名
        let observation_hash = keccak256(&observation.serialize());
        let signature = sign_with_guardian_key(observation_hash)?;
        
        // 4. 广播到P2P网络
        broadcast_observation(observation, signature).await?;
        
        info!(
            "Observed message: chain={}, emitter={}, seq={}",
            observation.emitter_chain,
            hex::encode(observation.emitter_address),
            observation.sequence
        );
    }
    
    Ok(())
}
```

**确认级别处理**:
```rust
async fn wait_for_confirmations(
    block_number: u64,
    required_confirmations: u64
) -> Result<()> {
    loop {
        let latest_block = provider.get_block_number().await?;
        let confirmations = latest_block.saturating_sub(block_number);
        
        if confirmations >= required_confirmations {
            return Ok(());
        }
        
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}
```

---

#### 3.1.2 监听 Solana 程序日志

**日志格式** (来自 solana-core 程序):
```rust
// Solana程序发出的日志
msg!(
    "MessagePublished: emitter={}, sequence={}, nonce={}, consistency_level={}, payload={}",
    emitter, sequence, nonce, consistency_level, hex::encode(&payload)
);
```

**Guardian 监听逻辑**:
```rust
pub async fn watch_solana_transactions(chain_config: ChainConfig) -> Result<()> {
    let rpc_client = RpcClient::new(&chain_config.rpc_url);
    
    // 订阅程序账户变化
    let (mut stream, _unsub) = rpc_client
        .logs_subscribe(
            RpcTransactionLogsFilter::Mentions(vec![
                chain_config.core_program.to_string()
            ]),
            Some(RpcTransactionLogsConfig {
                commitment: Some(CommitmentConfig::confirmed()),
            })
        )
        .await?;
    
    while let Some(log_update) = stream.next().await {
        match log_update.value {
            LogsNotification::Logs(logs) => {
                // 解析交易日志
                for log_line in logs.logs {
                    if log_line.contains("MessagePublished") {
                        let observation = parse_message_published_log(&log_line)?;
                        
                        // 等待确认
                        wait_for_solana_confirmations(
                            logs.signature,
                            chain_config.confirmations
                        ).await?;
                        
                        // 签名并广播
                        let observation_hash = keccak256(&observation.serialize());
                        let signature = sign_with_guardian_key(observation_hash)?;
                        broadcast_observation(observation, signature).await?;
                    }
                }
            }
            _ => {}
        }
    }
    
    Ok(())
}

fn parse_message_published_log(log: &str) -> Result<Observation> {
    // 正则解析日志
    let re = Regex::new(
        r"MessagePublished: emitter=(\w+), sequence=(\d+), nonce=(\d+), consistency_level=(\d+), payload=(\w+)"
    )?;
    
    let caps = re.captures(log).ok_or(Error::ParseError)?;
    
    Ok(Observation {
        emitter_chain: 2,  // Solana
        emitter_address: bs58_to_32_bytes(&caps[1])?,
        sequence: caps[2].parse()?,
        nonce: caps[3].parse()?,
        consistency_level: caps[4].parse()?,
        payload: hex::decode(&caps[5])?,
        // ... 其他字段
    })
}
```

---

### 3.2 输出接口: 提供VAA给Relayer

**接口**: `GET /v1/signed_vaa/{chain}/{emitter}/{sequence}` (见 2.1)

**数据流**:
```
1. Relayer发起查询请求
2. Guardian查询数据库中的VAA记录
3. 如果VAA已完成(≥13签名):
   - 从PostgreSQL读取完整VAA
   - 序列化为字节数组
   - 返回200和VAA数据
4. 如果VAA正在聚合中(<13签名):
   - 返回202和当前进度
   - Relayer继续轮询
5. 如果消息不存在:
   - 返回404
```

**数据库查询**:
```sql
-- 查询VAA及其签名
SELECT 
    v.vaa_id,
    v.emitter_chain,
    v.emitter_address,
    v.sequence,
    v.payload,
    v.timestamp,
    v.nonce,
    v.consistency_level,
    v.guardian_set_index,
    COUNT(s.signature_id) as signature_count,
    ARRAY_AGG(
        JSON_BUILD_OBJECT(
            'guardian_index', s.guardian_index,
            'signature', s.signature
        )
    ) as signatures
FROM vaas v
LEFT JOIN signatures s ON v.vaa_id = s.vaa_id
WHERE v.emitter_chain = $1
  AND v.emitter_address = $2
  AND v.sequence = $3
GROUP BY v.vaa_id
HAVING COUNT(s.signature_id) >= 13;
```

---

### 3.3 P2P 通信接口

Guardian之间通过libp2p进行P2P通信,使用Gossipsub协议。

#### 3.3.1 Observation消息

**用途**: Guardian观察到新消息后广播

**消息结构**:
```rust
#[derive(Serialize, Deserialize, Debug)]
pub struct ObservationMessage {
    pub message_hash: [u8; 32],       // 观察记录的哈希
    pub emitter_chain: u16,
    pub emitter_address: [u8; 32],
    pub sequence: u64,
    pub timestamp: u32,
    pub nonce: u32,
    pub payload: Vec<u8>,
    pub consistency_level: u8,
    pub guardian_index: u8,            // 发送者索引
    pub signature: [u8; 65],           // ECDSA签名 (r, s, v)
}
```

**广播逻辑**:
```rust
pub async fn broadcast_observation(
    observation: Observation,
    signature: Signature,
) -> Result<()> {
    let message = ObservationMessage {
        message_hash: observation.hash(),
        emitter_chain: observation.emitter_chain,
        emitter_address: observation.emitter_address,
        sequence: observation.sequence,
        timestamp: observation.timestamp,
        nonce: observation.nonce,
        payload: observation.payload,
        consistency_level: observation.consistency_level,
        guardian_index: GUARDIAN_INDEX,
        signature: signature.to_bytes(),
    };
    
    let topic = IdentTopic::new("observations");
    let serialized = serde_json::to_vec(&message)?;
    
    gossipsub.publish(topic, serialized)?;
    
    Ok(())
}
```

**接收处理**:
```rust
pub async fn handle_observation_message(msg: ObservationMessage) -> Result<()> {
    // 1. 验证签名
    verify_guardian_signature(
        msg.message_hash,
        &msg.signature,
        msg.guardian_index
    )?;
    
    // 2. 存储到数据库
    store_observation(&msg).await?;
    
    // 3. 检查是否已收集到自己的签名
    let has_own_signature = check_own_signature(msg.message_hash).await?;
    
    if !has_own_signature {
        // 4. 自己也对该消息签名
        let own_signature = sign_with_guardian_key(msg.message_hash)?;
        
        // 5. 广播自己的签名
        broadcast_signature(msg.message_hash, own_signature).await?;
    }
    
    Ok(())
}
```

---

#### 3.3.2 Signature消息

**用途**: Guardian对消息签名后广播

**消息结构**:
```rust
#[derive(Serialize, Deserialize, Debug)]
pub struct SignatureMessage {
    pub message_hash: [u8; 32],       // 观察记录的哈希
    pub guardian_index: u8,            // 签名者索引
    pub signature: [u8; 65],           // ECDSA签名 (r, s, v)
}
```

**广播逻辑**:
```rust
pub async fn broadcast_signature(
    message_hash: [u8; 32],
    signature: Signature,
) -> Result<()> {
    let message = SignatureMessage {
        message_hash,
        guardian_index: GUARDIAN_INDEX,
        signature: signature.to_bytes(),
    };
    
    let topic = IdentTopic::new("signatures");
    let serialized = serde_json::to_vec(&message)?;
    
    gossipsub.publish(topic, serialized)?;
    
    Ok(())
}
```

**接收处理**:
```rust
pub async fn handle_signature_message(msg: SignatureMessage) -> Result<()> {
    // 1. 验证签名有效性
    verify_guardian_signature(
        msg.message_hash,
        &msg.signature,
        msg.guardian_index
    )?;
    
    // 2. 存储签名到数据库
    store_signature(&msg).await?;
    
    // 3. 检查是否达到门限
    let signature_count = count_signatures(msg.message_hash).await?;
    
    if signature_count >= SIGNATURE_QUORUM {
        // 4. 构造VAA
        let vaa = construct_vaa(msg.message_hash).await?;
        
        // 5. 广播VAA就绪
        broadcast_vaa_ready(vaa).await?;
    }
    
    Ok(())
}
```

---

#### 3.3.3 VAAReady消息

**用途**: 签名达到门限后广播VAA就绪

**消息结构**:
```rust
#[derive(Serialize, Deserialize, Debug)]
pub struct VAAReadyMessage {
    pub message_hash: [u8; 32],       // 观察记录的哈希
    pub vaa: Vec<u8>,                  // 完整的VAA字节数组
}
```

**广播逻辑**:
```rust
pub async fn broadcast_vaa_ready(vaa: VAA) -> Result<()> {
    let message = VAAReadyMessage {
        message_hash: vaa.message_hash(),
        vaa: vaa.serialize(),
    };
    
    let topic = IdentTopic::new("vaa_ready");
    let serialized = serde_json::to_vec(&message)?;
    
    gossipsub.publish(topic, serialized)?;
    
    Ok(())
}
```

**接收处理**:
```rust
pub async fn handle_vaa_ready_message(msg: VAAReadyMessage) -> Result<()> {
    // 1. 验证VAA完整性
    let vaa = VAA::deserialize(&msg.vaa)?;
    verify_vaa(&vaa)?;
    
    // 2. 检查签名数量
    if vaa.signatures.len() < SIGNATURE_QUORUM as usize {
        return Err(Error::InsufficientSignatures);
    }
    
    // 3. 更新数据库状态
    mark_vaa_as_ready(msg.message_hash).await?;
    
    // 4. 缓存到Redis
    cache_vaa(&vaa).await?;
    
    info!("VAA ready: hash={}", hex::encode(msg.message_hash));
    
    Ok(())
}
```

---

## 4. 管理接口

### 4.1 POST /v1/admin/guardian/sign

**功能**: 手动触发对指定消息的签名 (调试/恢复用)

**鉴权**: 需要管理员Token + IP白名单

**请求**:
```http
POST /v1/admin/guardian/sign
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json

{
  "chain": 1,
  "emitter": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  "sequence": 42
}
```

**响应 200**:
```json
{
  "success": true,
  "messageHash": "0x5a7b8c9d...",
  "signature": "0x1a2b3c4d5e6f...",
  "guardianIndex": 1
}
```

**使用场景**:
- Guardian节点故障恢复后,补签历史消息
- 调试VAA聚合问题
- 紧急情况下手动触发签名

---

### 4.2 POST /v1/admin/config/reload

**功能**: 重新加载配置文件 (不重启服务)

**鉴权**: 需要管理员Token + IP白名单

**请求**:
```http
POST /v1/admin/config/reload
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**响应 200**:
```json
{
  "success": true,
  "message": "Configuration reloaded successfully",
  "changes": {
    "chains_added": ["polygon"],
    "chains_removed": [],
    "chains_updated": ["ethereum"]
  }
}
```

**可热重载的配置**:
- 链RPC URL
- 确认块数
- P2P引导节点
- Redis缓存TTL
- API速率限制

**不可热重载的配置**:
- Guardian私钥
- P2P监听端口
- 数据库连接字符串

---

## 5. 接口鉴权设计

### 5.1 公开接口 (无需鉴权)

以下接口对所有调用方开放:

- ✅ `GET /v1/signed_vaa/*` - 查询VAA
- ✅ `GET /v1/vaa/status/*` - 查询VAA状态
- ✅ `GET /v1/guardian/health` - 健康检查
- ✅ `GET /v1/guardian/metrics` - Prometheus指标

**理由**: 这些接口不涉及敏感操作,且需要被Relayer、监控系统、用户频繁调用。

---

### 5.2 管理接口鉴权

**鉴权方式**: Bearer Token (JWT) + IP白名单

**Token生成**:
```rust
use jsonwebtoken::{encode, Header, EncodingKey};

#[derive(Serialize, Deserialize)]
struct Claims {
    sub: String,        // "admin"
    exp: usize,         // 过期时间戳
    role: String,       // "admin" or "operator"
}

fn generate_admin_token() -> Result<String> {
    let secret = env::var("ADMIN_SECRET")?;
    
    let claims = Claims {
        sub: "admin".to_string(),
        exp: (Utc::now() + Duration::hours(1)).timestamp() as usize,
        role: "admin".to_string(),
    };
    
    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes())
    )?;
    
    Ok(token)
}
```

**Token验证**:
```rust
use jsonwebtoken::{decode, DecodingKey, Validation};

async fn verify_admin_token(
    token: &str,
    client_ip: &str,
) -> Result<Claims> {
    let secret = env::var("ADMIN_SECRET")?;
    
    // 1. 验证JWT签名
    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default()
    )?;
    
    // 2. 检查过期时间
    let now = Utc::now().timestamp() as usize;
    if token_data.claims.exp < now {
        return Err(Error::TokenExpired);
    }
    
    // 3. 检查IP白名单
    let admin_ips: Vec<String> = env::var("ADMIN_IPS")?
        .split(',')
        .map(|s| s.to_string())
        .collect();
    
    if !admin_ips.contains(&client_ip.to_string()) {
        return Err(Error::IPNotWhitelisted);
    }
    
    // 4. 检查角色权限
    if token_data.claims.role != "admin" {
        return Err(Error::InsufficientPermissions);
    }
    
    Ok(token_data.claims)
}
```

**Axum中间件**:
```rust
use axum::middleware::{self, Next};

async fn auth_middleware(
    req: Request<Body>,
    next: Next<Body>,
) -> Result<Response> {
    // 提取Authorization header
    let auth_header = req.headers()
        .get("Authorization")
        .and_then(|h| h.to_str().ok())
        .ok_or(Error::MissingAuthHeader)?;
    
    // 提取Bearer token
    let token = auth_header
        .strip_prefix("Bearer ")
        .ok_or(Error::InvalidAuthFormat)?;
    
    // 提取客户端IP
    let client_ip = req.headers()
        .get("X-Forwarded-For")
        .or_else(|| req.headers().get("X-Real-IP"))
        .and_then(|h| h.to_str().ok())
        .unwrap_or("unknown");
    
    // 验证Token
    verify_admin_token(token, client_ip).await?;
    
    // 继续处理请求
    Ok(next.run(req).await)
}

// 应用中间件
let admin_routes = Router::new()
    .route("/admin/guardian/sign", post(handle_manual_sign))
    .route("/admin/config/reload", post(handle_config_reload))
    .layer(middleware::from_fn(auth_middleware));
```

---

### 5.3 P2P网络鉴权

**鉴权方式**: Guardian公钥白名单 + 消息签名验证

**P2P节点连接**:
```rust
// 只接受白名单内的Guardian连接
pub fn create_p2p_config(guardian_set: GuardianSet) -> Libp2pConfig {
    Libp2pConfig {
        // 提取所有Guardian的PeerId
        allowed_peers: guardian_set.keys
            .iter()
            .map(|key| derive_peer_id(key))
            .collect(),
        
        // 拒绝其他节点
        connection_handler: Box::new(move |peer_id| {
            if !allowed_peers.contains(&peer_id) {
                return Err(ConnectionError::Unauthorized);
            }
            Ok(())
        }),
    }
}
```

**消息签名验证**:
```rust
pub fn verify_guardian_signature(
    message_hash: [u8; 32],
    signature: &[u8; 65],
    guardian_index: u8,
) -> Result<()> {
    // 1. 获取Guardian Set
    let guardian_set = get_current_guardian_set()?;
    
    // 2. 获取Guardian公钥
    let guardian_key = guardian_set.keys
        .get(guardian_index as usize)
        .ok_or(Error::InvalidGuardianIndex)?;
    
    // 3. 恢复签名者地址
    let recovered_address = recover_signer(message_hash, signature)?;
    
    // 4. 验证地址匹配
    if recovered_address != *guardian_key {
        return Err(Error::SignatureVerificationFailed);
    }
    
    Ok(())
}
```

---

## 6. 数据结构定义

### 6.1 VAA (Verified Action Approval)

```rust
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct VAA {
    /// Header
    pub version: u8,                      // 固定为1
    pub guardian_set_index: u32,          // Guardian Set版本
    
    /// Signatures
    pub signatures: Vec<Signature>,       // Guardian签名列表
    
    /// Body
    pub timestamp: u32,                   // Unix时间戳
    pub nonce: u32,                       // 随机数
    pub emitter_chain: u16,               // 源链ID
    pub emitter_address: [u8; 32],        // 发送者地址
    pub sequence: u64,                    // 消息序列号
    pub consistency_level: u8,            // 确认级别
    pub payload: Vec<u8>,                 // 消息载荷
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Signature {
    pub guardian_index: u8,               // Guardian索引 (0-18)
    pub r: [u8; 32],                      // ECDSA r值
    pub s: [u8; 32],                      // ECDSA s值
    pub v: u8,                            // 恢复ID
}
```

**序列化格式** (字节数组):
```
[version:1]
[guardian_set_index:4]
[signatures_len:1]
[signature_0: guardian_index:1 + r:32 + s:32 + v:1] * N
[timestamp:4]
[nonce:4]
[emitter_chain:2]
[emitter_address:32]
[sequence:8]
[consistency_level:1]
[payload:*]
```

---

### 6.2 Observation (观察记录)

```rust
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Observation {
    /// 交易信息
    pub tx_hash: [u8; 32],                // 交易哈希
    pub block_number: u64,                // 区块号
    pub block_timestamp: u32,             // 区块时间戳
    
    /// 消息信息
    pub emitter_chain: u16,               // 源链ID
    pub emitter_address: [u8; 32],        // 发送者地址
    pub sequence: u64,                    // 消息序列号
    pub nonce: u32,                       // 随机数
    pub payload: Vec<u8>,                 // 消息载荷
    pub consistency_level: u8,            // 确认级别
}

impl Observation {
    /// 计算观察记录的哈希 (用于签名)
    pub fn hash(&self) -> [u8; 32] {
        let mut data = Vec::new();
        data.extend_from_slice(&self.timestamp.to_be_bytes());
        data.extend_from_slice(&self.nonce.to_be_bytes());
        data.extend_from_slice(&self.emitter_chain.to_be_bytes());
        data.extend_from_slice(&self.emitter_address);
        data.extend_from_slice(&self.sequence.to_be_bytes());
        data.extend_from_slice(&self.consistency_level.to_be_bytes());
        data.extend_from_slice(&self.payload);
        
        keccak256(&data)
    }
}
```

---

### 6.3 Guardian Set

```rust
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GuardianSet {
    pub index: u32,                       // Set版本号
    pub keys: Vec<[u8; 20]>,              // Guardian地址列表 (Ethereum格式)
    pub creation_time: i64,               // 创建时间 (Unix时间戳)
    pub expiration_time: u32,             // 过期时间 (0表示active)
}

impl GuardianSet {
    pub fn is_active(&self) -> bool {
        self.expiration_time == 0 || 
        self.expiration_time > Utc::now().timestamp() as u32
    }
    
    pub fn verify_signature(
        &self,
        message_hash: [u8; 32],
        signature: &Signature,
    ) -> Result<()> {
        let guardian_key = self.keys
            .get(signature.guardian_index as usize)
            .ok_or(Error::InvalidGuardianIndex)?;
        
        let recovered_address = recover_signer(
            message_hash,
            &signature.to_bytes()
        )?;
        
        if recovered_address != *guardian_key {
            return Err(Error::SignatureVerificationFailed);
        }
        
        Ok(())
    }
}
```

---

### 6.4 链配置

```rust
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ChainConfig {
    pub chain_id: u16,                    // 链ID (1=Ethereum, 2=Solana)
    pub chain_type: ChainType,            // EVM或SVM
    pub name: String,                     // 链名称
    pub rpc_url: String,                  // RPC节点URL
    pub core_address: String,             // 核心合约/程序地址
    pub confirmations: u64,               // 确认块数
    pub enabled: bool,                    // 是否启用
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy)]
pub enum ChainType {
    EVM,
    SVM,
}

impl ChainConfig {
    pub fn load_from_file(path: &str) -> Result<Vec<Self>> {
        let content = fs::read_to_string(path)?;
        let configs: HashMap<String, HashMap<String, ChainConfig>> = 
            toml::from_str(&content)?;
        
        let mut chains = Vec::new();
        
        if let Some(evm_chains) = configs.get("chains.evm") {
            chains.extend(evm_chains.values().cloned());
        }
        
        if let Some(svm_chains) = configs.get("chains.svm") {
            chains.extend(svm_chains.values().cloned());
        }
        
        Ok(chains)
    }
}
```

---

## 7. 错误码规范

### 7.1 HTTP状态码

| 状态码 | 说明 | 使用场景 |
|-------|------|---------|
| 200 | 成功 | VAA已就绪,查询成功 |
| 202 | 已接受 | VAA聚合中,继续等待 |
| 400 | 请求参数错误 | 链ID无效、地址格式错误 |
| 401 | 未授权 | 缺少Token或Token无效 |
| 403 | 禁止访问 | IP不在白名单 |
| 404 | 资源不存在 | VAA或消息不存在 |
| 500 | 服务器内部错误 | 数据库错误、签名失败 |
| 503 | 服务不可用 | Guardian离线、数据库连接失败 |

---

### 7.2 错误响应格式

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error message",
    "details": {
      // 可选的详细信息
    }
  }
}
```

---

### 7.3 错误码列表

| 错误码 | HTTP状态 | 说明 |
|-------|---------|------|
| `VAA_NOT_FOUND` | 404 | VAA不存在 |
| `VAA_AGGREGATING` | 202 | VAA正在聚合中 |
| `INVALID_CHAIN_ID` | 400 | 无效的链ID |
| `INVALID_ADDRESS` | 400 | 地址格式错误 |
| `INVALID_SEQUENCE` | 400 | 序列号无效 |
| `MISSING_AUTH_HEADER` | 401 | 缺少Authorization头 |
| `INVALID_TOKEN` | 401 | Token无效 |
| `TOKEN_EXPIRED` | 401 | Token已过期 |
| `IP_NOT_WHITELISTED` | 403 | IP不在白名单 |
| `INSUFFICIENT_PERMISSIONS` | 403 | 权限不足 |
| `DATABASE_ERROR` | 500 | 数据库错误 |
| `SIGNATURE_FAILED` | 500 | 签名生成失败 |
| `GUARDIAN_OFFLINE` | 503 | Guardian节点离线 |
| `RPC_CONNECTION_FAILED` | 503 | RPC连接失败 |

---

## 8. 配置接口

### 8.1 Cargo 依赖配置

**重要**: Guardian 模块同时使用 `libp2p`、`ethers` 和 `solana-client`,需要仔细管理依赖版本以避免冲突。

**Cargo.toml 推荐配置**:

```toml
[package]
name = "guardian"
version = "0.1.0"
edition = "2021"
rust-version = "1.75"

[dependencies]
# P2P 网络
libp2p = { version = "0.53.2", features = [
    "gossipsub",
    "tcp",
    "noise",
    "mplex",
    "identify",
    "kad",
    "ping"
] }

# EVM 链客户端 (禁用默认features减少冲突)
ethers = { version = "2.0.11", default-features = false, features = [
    "ws",
    "rustls",
    "abigen"
] }
ethers-providers = "2.0.11"
ethers-core = "2.0.11"

# Solana 链客户端 (禁用默认features)
solana-client = { version = "1.17.15", default-features = false }
solana-sdk = "1.17.15"

# 异步运行时 (统一版本)
tokio = { version = "1.35.1", features = [
    "macros",
    "rt-multi-thread",
    "sync",
    "time",
    "signal",
    "fs"
] }

# Web 框架
axum = { version = "0.7", features = ["ws"] }
tower = "0.4"
tower-http = { version = "0.5", features = ["cors", "trace"] }

# 数据库
sqlx = { version = "0.7", features = ["postgres", "runtime-tokio-rustls", "json"] }
redis = { version = "0.24", features = ["tokio-comp", "connection-manager"] }

# 序列化
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
bincode = "1.3"

# 加密
secp256k1 = { version = "0.28", features = ["recovery"] }
sha3 = "0.10"

# 监控
prometheus = "0.13"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }

# 工具
anyhow = "1.0"
thiserror = "1.0"
hex = "0.4"

# 共享依赖 - 强制统一版本以避免冲突
tonic = "0.10"
prost = "0.12"
hyper = "0.14"

[features]
default = ["evm-watcher", "solana-watcher", "p2p", "api"]
evm-watcher = ["ethers", "ethers-providers"]
solana-watcher = ["solana-client", "solana-sdk"]
p2p = ["libp2p"]
api = ["axum", "tower", "tower-http"]
full = ["default"]

[dev-dependencies]
tokio-test = "0.4"
mockall = "0.12"
criterion = "0.5"

[profile.release]
opt-level = 3
lto = true
codegen-units = 1

[patch.crates-io]
# 如果遇到依赖冲突,可以在这里统一patch版本
# 例如: tokio = { git = "https://github.com/tokio-rs/tokio", tag = "tokio-1.35.1" }
```

**依赖冲突检查**:

在开始开发前,务必执行以下检查:

```bash
# 检查依赖树
cargo tree -d

# 检查特定包的版本冲突
cargo tree -p tokio -i
cargo tree -p tonic -i
cargo tree -p prost -i

# 尝试编译
cargo build --all-features

# 运行测试
cargo test --all-features
```

**Workspace 架构配置** (精简4-Crate设计):

```toml
# workspace Cargo.toml (guardians/Cargo.toml)
[workspace]
members = [
    "guardian-core",      # 核心逻辑 + libp2p
    "guardian-evm",       # EVM监听器 (ethers)
    "guardian-solana",    # Solana监听器 (solana-client)
    "guardian-bin",       # 主程序入口
]

resolver = "2"

[workspace.dependencies]
# 统一管理版本
tokio = { version = "1.35.1", features = ["full"] }
serde = { version = "1.0", features = ["derive"] }
anyhow = "1.0"
thiserror = "1.0"
tracing = "0.1"
tracing-subscriber = "0.3"

# 内部 crate 引用
guardian-core = { path = "guardian-core" }
guardian-evm = { path = "guardian-evm" }
guardian-solana = { path = "guardian-solana" }
```

**各 Crate 的 Cargo.toml**:

```toml
# guardian-core/Cargo.toml
[package]
name = "guardian-core"
version = "0.1.0"
edition = "2021"

[dependencies]
# P2P网络
libp2p = { version = "0.53.2", features = ["gossipsub", "tcp", "noise", "mplex"] }

# Web框架
axum = "0.7"
tower-http = "0.5"

# 数据库
sqlx = { version = "0.7", features = ["postgres", "runtime-tokio-rustls"] }
redis = { version = "0.24", features = ["tokio-comp"] }

# 加密
secp256k1 = { version = "0.28", features = ["recovery"] }
sha3 = "0.10"

# 基础库 (使用workspace统一版本)
tokio = { workspace = true }
serde = { workspace = true }
anyhow = { workspace = true }
tracing = { workspace = true }

# guardian-evm/Cargo.toml
[package]
name = "guardian-evm"
version = "0.1.0"
edition = "2021"

[dependencies]
guardian-core = { workspace = true }  # 只依赖core的类型
ethers = { version = "2.0.11", default-features = false, features = ["ws", "rustls"] }
tokio = { workspace = true }
anyhow = { workspace = true }
tracing = { workspace = true }

# guardian-solana/Cargo.toml
[package]
name = "guardian-solana"
version = "0.1.0"
edition = "2021"

[dependencies]
guardian-core = { workspace = true }  # 只依赖core的类型
solana-client = { version = "1.17.15", default-features = false }
solana-sdk = "1.17.15"
tokio = { workspace = true }
anyhow = { workspace = true }
tracing = { workspace = true }

# guardian-bin/Cargo.toml
[package]
name = "guardian-bin"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "guardian"
path = "src/main.rs"

[dependencies]
guardian-core = { workspace = true }
guardian-evm = { workspace = true }
guardian-solana = { workspace = true }
tokio = { workspace = true }
anyhow = { workspace = true }
tracing = { workspace = true }
tracing-subscriber = { workspace = true }
```

**CI/CD 依赖检查**:

```yaml
# .github/workflows/check-deps.yml
name: Check Dependencies

on: [push, pull_request]

jobs:
  check-deps:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Install Rust
        uses: actions-rs/toolchain@v1
        with:
          toolchain: stable
      
      - name: Check for dependency conflicts
        run: |
          cargo tree -d > deps-conflicts.txt
          if [ -s deps-conflicts.txt ]; then
            echo "❌ Dependency conflicts detected:"
            cat deps-conflicts.txt
            exit 1
          else
            echo "✅ No dependency conflicts"
          fi
      
      - name: Verify features compile
        run: |
          cargo build --no-default-features --features evm-watcher
          cargo build --no-default-features --features solana-watcher
          cargo build --no-default-features --features p2p
          cargo build --all-features
```

---

### 8.2 配置文件结构

**config/guardian.toml**:
```toml
[guardian]
index = 0  # Guardian索引 (0-18)
private_key = "0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d"

[api]
host = "0.0.0.0"
port = 7071
rate_limit = 100  # 每秒请求数

[p2p]
listen_address = "/ip4/0.0.0.0/tcp/8999"
bootstrap_peers = [
    "/ip4/192.168.1.1/tcp/8999/p2p/12D3KooW...",
    "/ip4/192.168.1.2/tcp/8999/p2p/12D3KooW..."
]

[database]
postgres_url = "postgresql://user:pass@localhost/bridge"
redis_url = "redis://localhost:6379"
max_connections = 100

[chains.evm.ethereum]
chain_id = 1
rpc_url = "https://eth.llamarpc.com"
core_contract = "0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B"
confirmations = 64
enabled = true

[chains.evm.bsc]
chain_id = 56
rpc_url = "https://bsc-dataseed.binance.org"
core_contract = "0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B"
confirmations = 15
enabled = true

[chains.svm.solana]
chain_id = 2
rpc_url = "https://api.mainnet-beta.solana.com"
core_program = "worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth"
confirmations = 32
enabled = true

[monitoring]
prometheus_port = 9090
log_level = "info"

[admin]
secret = "your-secret-key-change-me"
allowed_ips = ["192.168.1.100", "10.0.0.1"]
```

---

### 8.2 环境变量

```bash
# Guardian配置
GUARDIAN_INDEX=0
GUARDIAN_PRIVATE_KEY=0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d

# API配置
API_HOST=0.0.0.0
API_PORT=7071
API_RATE_LIMIT=100

# 数据库
POSTGRES_URL=postgresql://user:pass@localhost/bridge
REDIS_URL=redis://localhost:6379

# 管理员
ADMIN_SECRET=your-secret-key-change-me
ADMIN_IPS=192.168.1.100,10.0.0.1

# 监控
PROMETHEUS_PORT=9090
LOG_LEVEL=info
```

---

## 附录

### A. VAA序列化示例

**示例VAA**:
```
版本: 1
Guardian Set Index: 0
签名数: 13
签名:
  [0] 1a2b3c... (Guardian 0)
  [1] 4d5e6f... (Guardian 1)
  ...
时间戳: 1699276800
Nonce: 0
源链: 1 (Ethereum)
发送者: 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb
序列号: 42
确认级别: 200
载荷: 0x01000000000000000000000003e8...
```

**字节数组** (十六进制):
```
01                    # version
00000000              # guardian_set_index
0d                    # signatures_len (13)
00 1a2b3c... (66字节)  # signature 0
01 4d5e6f... (66字节)  # signature 1
...
637a9c00              # timestamp
00000000              # nonce
0001                  # emitter_chain
742d35cc6634c0532925a3b844bc9e7595f0beb000000000000000000000000  # emitter_address (32字节)
000000000000002a      # sequence
c8                    # consistency_level
01000000000000000000000003e8...  # payload
```

---

### B. 性能基准

| 指标 | 目标值 | 说明 |
|------|--------|------|
| VAA生成时间 | <30秒 | 从消息发布到VAA就绪 |
| API响应延迟 | <100ms | 查询已完成的VAA |
| P2P消息延迟 | <500ms | 签名在Guardian网络中传播 |
| 数据库查询延迟 | <20ms | PostgreSQL查询 |
| Redis缓存命中率 | >90% | 热点VAA查询 |
| 系统可用性 | ≥99.9% | 每年停机时间<8.76小时 |

---

**文档状态**: ✅ v1.0 已完成  
**维护者**: Guardian开发团队  
**下次更新**: 根据开发进度同步更新

