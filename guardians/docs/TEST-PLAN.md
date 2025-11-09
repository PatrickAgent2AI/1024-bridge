# Guardian 模块 - 测试套件规划

> **文档版本**: v1.0  
> **创建日期**: 2025-11-09  
> **子模块**: guardians  
> **父模块**: newlife 跨链桥项目

---

## 📋 目录

1. [测试策略](#1-测试策略)
2. [核心测试场景](#2-核心测试场景)
3. [测试环境配置](#3-测试环境配置)
4. [测试数据准备](#4-测试数据准备)
5. [CI/CD集成](#5-cicd集成)

---

## 1. 测试策略

### 1.1 测试分层

```
┌──────────────────────────────────────────┐
│  端到端测试 (E2E)                         │  20%
│  - 完整VAA生成流程                        │
│  - 多Guardian共识测试                     │
│  - Guardian Set升级测试                   │
└──────────────────────────────────────────┘
                 ↓
┌──────────────────────────────────────────┐
│  集成测试                                 │  40%
│  - REST API接口测试                       │
│  - 链监听器测试                           │
│  - P2P网络通信测试                        │
│  - 数据库交互测试                         │
└──────────────────────────────────────────┘
                 ↓
┌──────────────────────────────────────────┐
│  单元测试                                 │  40%
│  - 签名生成和验证                         │
│  - VAA序列化/反序列化                     │
│  - 配置加载                               │
│  - 工具函数                               │
└──────────────────────────────────────────┘
```

---

### 1.2 测试覆盖目标

| 测试类型 | 覆盖率目标 | 用例数 | 预计时间 |
|---------|-----------|--------|---------|
| **E2E测试** | 100%关键流程 | 6个场景 | 40分钟 |
| **集成测试** | 90%接口 | 32个用例 | 25分钟 |
| **单元测试** | 90%代码 | 50个用例 | 15分钟 |
| **总计** | - | **88个** | **80分钟** |

---

### 1.3 测试优先级

| 优先级 | 测试内容 | 说明 |
|-------|---------|------|
| **P0** | VAA生成流程、签名共识、API核心接口 | 核心功能,必须通过 |
| **P1** | 链监听、P2P通信、管理接口鉴权 | 重要功能 |
| **P2** | 监控指标、日志记录、配置热重载 | 辅助功能 |

---

## 2. 核心测试场景

### 2.1 端到端测试场景 (E2E)

#### E2E-G-001: 完整VAA生成流程 ⭐⭐⭐

**测试目标**: 验证从链上事件到VAA生成的完整流程

**前置条件**:
- 19个Guardian节点运行中
- Ethereum测试网已部署BridgeCore合约
- PostgreSQL和Redis已启动

**测试步骤**:

```
步骤1: 用户在源链发布消息
  - 调用 BridgeCore.publishMessage(nonce=1, payload=0xabcd, consistencyLevel=200)
  - 验证: LogMessagePublished事件发出
  - 记录: 区块号 B, 交易哈希 TX

步骤2: Guardian监听事件
  - 等待64个确认块 (约13分钟)
  - 验证: 19个Guardian都检测到事件
  - 查询日志: "Observed message: chain=1, emitter=0x..., seq=X"

步骤3: Guardian生成签名
  - 每个Guardian对观察记录签名
  - 验证: 19个Guardian都生成签名
  - 查询数据库: SELECT COUNT(*) FROM signatures WHERE message_hash = ?
  - 预期: 19个签名

步骤4: P2P网络传播
  - Guardian通过libp2p广播签名
  - 验证: 每个Guardian都收到其他18个Guardian的签名
  - 检查P2P日志: "Received signature from guardian_X"

步骤5: 签名聚合
  - 第13个签名到达时触发聚合
  - 验证: VAA构造完成
  - 查询数据库: SELECT * FROM vaas WHERE message_hash = ?
  - 验证: status = 'ready', signature_count >= 13

步骤6: VAA查询
  - 调用 GET /v1/signed_vaa/{chain}/{emitter}/{sequence}
  - 验证: 返回200状态码
  - 验证: VAA包含13+个签名
  - 验证: VAA payload与原始消息一致

步骤7: VAA验证
  - 反序列化VAA
  - 验证每个签名的有效性
  - 验证Guardian Set Index正确
  - 验证时间戳在合理范围内
```

**成功标准**:
- ✅ 所有19个Guardian都观察到事件
- ✅ 所有19个Guardian都生成签名
- ✅ VAA在第13个签名后生成
- ✅ 总时间 < 15分钟
- ✅ VAA可被成功查询和验证

**失败场景测试**:
```
场景A: 部分Guardian离线
  - 停止6个Guardian节点 (剩余13个)
  - 发布消息
  - 验证: VAA仍然能生成 (13/13签名)

场景B: 网络分区
  - 模拟网络分区,10个Guardian在分区A,9个在分区B
  - 验证: 分区A能达成共识,分区B不能
  - 恢复网络
  - 验证: 两个分区的签名最终合并

场景C: 签名延迟
  - 模拟某些Guardian签名延迟(延迟5分钟)
  - 验证: VAA仍能生成(使用其他Guardian的签名)
  - 延迟的签名到达后也被记录
```

---

#### E2E-G-002: 多链并发监听测试 ⭐⭐⭐

**测试目标**: 验证Guardian同时监听多条链的能力

**前置条件**:
- Guardian配置启用3条链: Ethereum, BSC, Solana
- 所有链的测试合约已部署

**测试步骤**:

```
步骤1: 在三条链同时发布消息
  - Ethereum: publishMessage(seq=1)
  - BSC: publishMessage(seq=1)
  - Solana: post_message(seq=1)
  - 时间间隔 < 1秒

步骤2: Guardian并发监听
  - 验证: Guardian的3个Watcher线程都工作正常
  - 检查日志: 每条链的事件都被观察到

步骤3: 并发签名
  - Guardian对3条链的消息分别签名
  - 验证: 签名不冲突,顺序正确

步骤4: VAA生成
  - 验证: 3个VAA都正确生成
  - 验证: 每个VAA的 emitter_chain 正确
  - 验证: 签名不串用

步骤5: 查询验证
  - 查询3个VAA
  - 验证: 都能正确返回
  - 验证: 数据隔离正确
```

**成功标准**:
- ✅ 3条链的消息都被正确处理
- ✅ 没有签名冲突或数据混淆
- ✅ VAA生成时间 < 15分钟/条
- ✅ 数据库事务隔离正确

---

#### E2E-G-003: Guardian Set 升级测试 ⭐⭐⭐

**测试目标**: 验证Guardian Set升级期间的VAA生成

**前置条件**:
- 当前Guardian Set (索引0, 19个节点)正常运行
- 准备新的Guardian Set (索引1, 19个新节点)

**测试步骤**:

```
阶段1: 升级前
  - 发布消息M1
  - 验证: 旧Set (索引0) 签名并生成VAA
  - 验证: VAA的 guardian_set_index = 0

阶段2: 提交升级提案
  - 在链上提交 updateGuardianSet VAA
  - 新Set状态设为 "pending"
  - 验证: 旧Set继续工作

阶段3: 激活新Set (过渡期开始)
  - 激活新Guardian Set (索引1)
  - 新旧Set并存7天
  - 启动19个新Guardian节点

阶段4: 过渡期测试
  - 发布消息M2
  - 验证: 旧Set (索引0) 仍能生成VAA
  - 验证: 新Set (索引1) 也能生成VAA
  - 验证: M2可以被任一Set签名

阶段5: 新Set独立工作
  - 发布消息M3
  - 仅新Guardian节点响应
  - 验证: 新Set生成VAA (索引1)
  - 验证: VAA有效

阶段6: 旧Set过期
  - 7天后过期旧Set
  - 发布消息M4
  - 验证: 只有新Set能生成VAA
  - 验证: 旧Set的签名被拒绝

阶段7: 验证跨链消息
  - 使用旧Set签名的VAA在目标链验证
  - 验证: 过渡期内生成的VAA仍然有效
  - 验证: 过期后旧Set的VAA被拒绝
```

**成功标准**:
- ✅ 升级期间VAA生成不中断
- ✅ 新旧Set并存期正确工作
- ✅ 过期机制正确触发
- ✅ 跨链验证逻辑一致

---

#### E2E-G-004: 高并发VAA生成测试 ⭐⭐

**测试目标**: 验证Guardian在高负载下的性能

**测试步骤**:

```
步骤1: 快速发布100个消息
  - 在10秒内发布100个消息
  - 序列号: 1-100

步骤2: Guardian处理
  - 监控Guardian CPU和内存使用
  - 验证: 所有100个消息都被观察到
  - 验证: 无消息丢失

步骤3: 签名生成
  - 验证: 100个消息都完成签名
  - 验证: 签名顺序正确

步骤4: P2P网络压力
  - 监控P2P消息队列
  - 验证: 无消息丢失
  - 验证: 消息传播延迟 < 1秒

步骤5: VAA聚合
  - 验证: 100个VAA都生成成功
  - 记录平均聚合时间
  - 验证: 聚合时间 < 30秒/个

步骤6: 数据库性能
  - 验证: PostgreSQL查询延迟 < 50ms
  - 验证: Redis缓存命中率 > 80%
  - 验证: 无死锁或超时
```

**性能指标**:
- VAA生成吞吐量: ≥ 10个/分钟
- 平均签名时间: < 100ms
- P2P消息延迟: < 500ms
- 数据库写入延迟: < 20ms

---

#### E2E-G-005: 链重组处理测试 ⭐⭐

**测试目标**: 验证Guardian处理链重组的能力

**测试步骤**:

```
步骤1: 发布消息
  - 在Ethereum发布消息
  - 交易在区块N确认

步骤2: Guardian开始观察
  - 等待10个确认块
  - 准备签名

步骤3: 模拟链重组
  - 回滚Ethereum测试网到区块N-5
  - 交易被重新打包到区块N+10

步骤4: Guardian检测重组
  - 验证: Guardian检测到区块重组
  - 检查日志: "Chain reorg detected: from=N, to=N+10"
  - 验证: Guardian停止对旧区块的处理

步骤5: 重新观察
  - Guardian重新观察区块N+10
  - 等待64个确认块
  - 验证: 序列号保持不变

步骤6: 重新签名
  - Guardian重新对消息签名
  - 验证: 基于新区块号的签名
  - 验证: VAA最终生成

步骤7: 验证VAA
  - 验证: VAA引用正确的区块
  - 验证: 无重复VAA
  - 验证: 旧区块的观察记录被清除
```

**成功标准**:
- ✅ 检测到链重组
- ✅ 正确处理重组后的区块
- ✅ 无重复VAA生成
- ✅ 跨链消息不丢失

---

#### E2E-G-006: 异常恢复测试 ⭐⭐

**测试目标**: 验证Guardian节点故障恢复能力

**测试场景**:

**场景A: 节点崩溃恢复**
```
步骤1: 正常运行
  - Guardian节点正常处理消息

步骤2: 模拟崩溃
  - kill -9 杀死Guardian进程

步骤3: 重启节点
  - 重启Guardian
  - 验证: 从数据库恢复状态

步骤4: 补签历史消息
  - 检查数据库中未完成的VAA
  - 对缺失的签名进行补签
  - 验证: 历史VAA完成聚合

步骤5: 继续正常工作
  - 处理新消息
  - 验证: 功能正常
```

**场景B: 数据库连接断开**
```
步骤1: 正常运行
  - Guardian连接PostgreSQL

步骤2: 断开数据库
  - 停止PostgreSQL服务

步骤3: Guardian检测断开
  - 验证: 健康检查返回503
  - 验证: 继续监听链上事件(缓存在内存)

步骤4: 恢复数据库
  - 启动PostgreSQL

步骤5: 自动重连
  - Guardian自动重连数据库
  - 验证: 内存中的数据写入数据库
  - 验证: 健康检查返回200
```

**场景C: RPC节点故障**
```
步骤1: 正常运行
  - Guardian使用RPC_URL_1

步骤2: RPC节点故障
  - 模拟RPC_URL_1不可用

步骤3: 自动切换
  - Guardian切换到RPC_URL_2 (备用)
  - 验证: 继续监听事件
  - 验证: 无消息丢失

步骤4: 主RPC恢复
  - RPC_URL_1恢复正常

步骤5: 切回主RPC
  - Guardian切回主RPC
  - 验证: 平滑切换
```

---

### 2.2 集成测试场景 (32个用例)

#### 2.2.1 REST API测试 (12个用例)

| 测试ID | 接口 | 测试场景 | 优先级 |
|-------|------|---------|--------|
| API-G-001 | GET /v1/signed_vaa | VAA已就绪,返回200 | P0 |
| API-G-002 | GET /v1/signed_vaa | VAA聚合中,返回202 | P0 |
| API-G-003 | GET /v1/signed_vaa | VAA不存在,返回404 | P0 |
| API-G-004 | GET /v1/signed_vaa | 无效的链ID,返回400 | P1 |
| API-G-005 | GET /v1/signed_vaa | Redis缓存命中 | P1 |
| API-G-006 | GET /v1/vaa/status | 聚合中,显示进度 | P0 |
| API-G-007 | GET /v1/vaa/status | 已完成,显示完整信息 | P0 |
| API-G-008 | GET /v1/guardian/health | 健康状态,返回200 | P0 |
| API-G-009 | GET /v1/guardian/health | 不健康状态,返回503 | P0 |
| API-G-010 | GET /v1/guardian/metrics | Prometheus指标格式 | P1 |
| API-G-011 | GET /v1/guardian/metrics | 指标数值正确性 | P1 |
| API-G-012 | 所有API | 速率限制(100 req/s) | P2 |

**测试示例: API-G-001**
```rust
#[tokio::test]
async fn test_get_signed_vaa_ready() {
    // 准备数据
    let vaa = create_test_vaa();
    store_vaa_to_db(&vaa).await;
    
    // 发起请求
    let response = client
        .get("/v1/signed_vaa/1/0x742d35.../42")
        .send()
        .await?;
    
    // 验证响应
    assert_eq!(response.status(), 200);
    
    let body: VAAResponse = response.json().await?;
    assert_eq!(body.vaa.emitter_chain, 1);
    assert_eq!(body.vaa.sequence, 42);
    assert!(body.vaa.signatures.len() >= 13);
    
    // 验证VAA字节数组
    let vaa_bytes = hex::decode(&body.vaa_bytes[2..])?;
    let deserialized = VAA::deserialize(&vaa_bytes)?;
    assert_eq!(deserialized, vaa);
}
```

---

#### 2.2.2 链监听器测试 (8个用例)

| 测试ID | 组件 | 测试场景 | 优先级 |
|-------|------|---------|--------|
| WATCH-G-001 | EVM Watcher | 监听LogMessagePublished事件 | P0 |
| WATCH-G-002 | EVM Watcher | 等待确认块数 | P0 |
| WATCH-G-003 | EVM Watcher | 检测链重组 | P0 |
| WATCH-G-004 | EVM Watcher | RPC连接失败重试 | P1 |
| WATCH-G-005 | Solana Watcher | 监听程序日志 | P0 |
| WATCH-G-006 | Solana Watcher | 解析MessagePublished日志 | P0 |
| WATCH-G-007 | Solana Watcher | 等待Slot确认 | P0 |
| WATCH-G-008 | 多链Watcher | 并发监听不冲突 | P1 |

**测试示例: WATCH-G-001**
```rust
#[tokio::test]
async fn test_evm_watcher_observes_event() {
    // 部署测试合约
    let contract = deploy_bridge_core().await?;
    
    // 启动Watcher
    let watcher = EVMWatcher::new(chain_config);
    let (tx, mut rx) = mpsc::channel(100);
    
    tokio::spawn(async move {
        watcher.watch(tx).await
    });
    
    // 发布消息
    let tx_hash = contract
        .publish_message(1, b"test".to_vec(), 200)
        .send()
        .await?
        .await?;
    
    // 等待观察
    let observation = tokio::time::timeout(
        Duration::from_secs(300),
        rx.recv()
    ).await??;
    
    // 验证观察记录
    assert_eq!(observation.emitter_chain, 1);
    assert_eq!(observation.payload, b"test");
    assert_eq!(observation.tx_hash, tx_hash);
}
```

---

#### 2.2.3 P2P网络测试 (6个用例)

| 测试ID | 测试场景 | 优先级 |
|-------|---------|--------|
| P2P-G-001 | Guardian节点互相发现 | P0 |
| P2P-G-002 | 广播Observation消息 | P0 |
| P2P-G-003 | 接收Signature消息 | P0 |
| P2P-G-004 | 广播VAAReady消息 | P0 |
| P2P-G-005 | 网络分区自动恢复 | P1 |
| P2P-G-006 | 拒绝非白名单节点 | P1 |

**测试示例: P2P-G-002**
```rust
#[tokio::test]
async fn test_p2p_broadcast_observation() {
    // 启动3个Guardian节点
    let guardian_0 = spawn_guardian(0).await?;
    let guardian_1 = spawn_guardian(1).await?;
    let guardian_2 = spawn_guardian(2).await?;
    
    // 等待P2P连接建立
    tokio::time::sleep(Duration::from_secs(5)).await;
    
    // Guardian-0 广播观察记录
    let observation = create_test_observation();
    guardian_0.broadcast_observation(observation.clone()).await?;
    
    // 验证其他节点收到
    tokio::time::sleep(Duration::from_secs(2)).await;
    
    let received_1 = guardian_1.get_observations().await?;
    assert!(received_1.contains(&observation));
    
    let received_2 = guardian_2.get_observations().await?;
    assert!(received_2.contains(&observation));
}
```

---

#### 2.2.4 签名与验证测试 (6个用例)

| 测试ID | 测试场景 | 优先级 |
|-------|---------|--------|
| SIGN-G-001 | 生成ECDSA签名 | P0 |
| SIGN-G-002 | 验证签名有效性 | P0 |
| SIGN-G-003 | 拒绝无效签名 | P0 |
| SIGN-G-004 | 恢复签名者地址 | P0 |
| SIGN-G-005 | 签名确定性(相同输入=相同输出) | P1 |
| SIGN-G-006 | 并发签名无冲突 | P1 |

**测试示例: SIGN-G-001**
```rust
#[test]
fn test_generate_signature() {
    // 准备Guardian私钥
    let private_key = "0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d";
    let signer = Signer::new(private_key)?;
    
    // 准备消息哈希
    let message_hash = keccak256(b"test message");
    
    // 生成签名
    let signature = signer.sign(message_hash)?;
    
    // 验证签名格式
    assert_eq!(signature.len(), 65);
    
    // 恢复签名者地址
    let recovered = recover_signer(message_hash, &signature)?;
    let expected = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
    
    assert_eq!(hex::encode(recovered), expected);
}
```

---

### 2.3 单元测试场景 (50个用例)

**分类**:
- VAA序列化/反序列化: 8个
- 签名工具函数: 6个
- 配置加载: 5个
- 数据库操作: 10个
- 地址转换: 6个
- 时间处理: 5个
- 错误处理: 10个

**示例: VAA序列化测试**
```rust
#[test]
fn test_vaa_serialization() {
    let vaa = VAA {
        version: 1,
        guardian_set_index: 0,
        signatures: vec![
            Signature { guardian_index: 0, r: [0u8; 32], s: [0u8; 32], v: 27 },
            Signature { guardian_index: 1, r: [1u8; 32], s: [1u8; 32], v: 27 },
        ],
        timestamp: 1699276800,
        nonce: 0,
        emitter_chain: 1,
        emitter_address: [0u8; 32],
        sequence: 42,
        consistency_level: 200,
        payload: vec![0xab, 0xcd],
    };
    
    // 序列化
    let bytes = vaa.serialize();
    
    // 反序列化
    let deserialized = VAA::deserialize(&bytes).unwrap();
    
    // 验证
    assert_eq!(vaa, deserialized);
}
```

---

## 3. 测试环境配置

### 3.1 本地测试环境

**Docker Compose配置**:
```yaml
version: '3.8'

services:
  # PostgreSQL数据库
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: bridge_test
      POSTGRES_USER: bridge
      POSTGRES_PASSWORD: test123
    ports:
      - "5432:5432"
    volumes:
      - ./scripts/init-db.sql:/docker-entrypoint-initdb.d/init.sql
  
  # Redis缓存
  redis:
    image: redis:7
    ports:
      - "6379:6379"
  
  # Ethereum测试节点 (Hardhat)
  ethereum:
    image: node:18
    command: npx hardhat node
    ports:
      - "8545:8545"
    volumes:
      - ./contracts/evm:/workspace
  
  # Solana测试节点
  solana:
    image: solanalabs/solana:latest
    command: solana-test-validator --reset
    ports:
      - "8899:8899"
      - "8900:8900"
  
  # Guardian节点 (模拟3个)
  guardian-0:
    build: .
    environment:
      GUARDIAN_INDEX: 0
      GUARDIAN_PRIVATE_KEY: ${GUARDIAN_0_KEY}
      POSTGRES_URL: postgresql://bridge:test123@postgres/bridge_test
      REDIS_URL: redis://redis:6379
    depends_on:
      - postgres
      - redis
      - ethereum
      - solana
  
  guardian-1:
    build: .
    environment:
      GUARDIAN_INDEX: 1
      GUARDIAN_PRIVATE_KEY: ${GUARDIAN_1_KEY}
      POSTGRES_URL: postgresql://bridge:test123@postgres/bridge_test
      REDIS_URL: redis://redis:6379
    depends_on:
      - postgres
      - redis
  
  guardian-2:
    build: .
    environment:
      GUARDIAN_INDEX: 2
      GUARDIAN_PRIVATE_KEY: ${GUARDIAN_2_KEY}
      POSTGRES_URL: postgresql://bridge:test123@postgres/bridge_test
      REDIS_URL: redis://redis:6379
    depends_on:
      - postgres
      - redis
```

**启动测试环境**:
```bash
# 启动所有服务
docker-compose -f docker-compose.test.yml up -d

# 等待服务就绪
./scripts/wait-for-services.sh

# 运行测试
cargo test --all-features
```

---

### 3.2 测试网环境

**支持的测试网**:
- Ethereum: Sepolia
- BSC: BSC Testnet
- Solana: Devnet

**Guardian节点部署**:
- 5个Guardian节点 (模拟19个,门限调整为3/5)
- 部署在不同的AWS区域

**配置文件** (config/testnet.toml):
```toml
[guardian]
index = 0

[chains.evm.sepolia]
chain_id = 11155111
rpc_url = "https://sepolia.infura.io/v3/YOUR_KEY"
core_contract = "0x..."
confirmations = 10

[chains.svm.devnet]
chain_id = 2
rpc_url = "https://api.devnet.solana.com"
core_program = "..."
confirmations = 32
```

---

## 4. 测试数据准备

### 4.1 Guardian密钥

**测试密钥** (⚠️ 仅用于测试):
```yaml
guardians:
  - index: 0
    private_key: "0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d"
    address: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"
  
  - index: 1
    private_key: "0x6cbed15c793ce57650b9877cf6fa156fbef513c4e6134f022a85b1ffdd59b2a1"
    address: "0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199"
  
  # ... 19个Guardian密钥
```

---

### 4.2 测试消息

```rust
pub fn create_test_observation() -> Observation {
    Observation {
        tx_hash: [0xabu8; 32],
        block_number: 12345,
        block_timestamp: 1699276800,
        emitter_chain: 1,
        emitter_address: [0x74u8; 32],
        sequence: 42,
        nonce: 0,
        payload: vec![0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0xe8],
        consistency_level: 200,
    }
}

pub fn create_test_vaa() -> VAA {
    VAA {
        version: 1,
        guardian_set_index: 0,
        signatures: (0..13).map(|i| Signature {
            guardian_index: i,
            r: [i as u8; 32],
            s: [i as u8; 32],
            v: 27,
        }).collect(),
        timestamp: 1699276800,
        nonce: 0,
        emitter_chain: 1,
        emitter_address: [0x74u8; 32],
        sequence: 42,
        consistency_level: 200,
        payload: vec![0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0xe8],
    }
}
```

---

### 4.3 数据库测试数据

**初始化SQL** (scripts/init-db.sql):
```sql
-- 清空表
TRUNCATE TABLE observations CASCADE;
TRUNCATE TABLE signatures CASCADE;
TRUNCATE TABLE vaas CASCADE;
TRUNCATE TABLE guardian_sets CASCADE;

-- 插入测试Guardian Set
INSERT INTO guardian_sets (index, keys, creation_time, expiration_time)
VALUES (
    0,
    ARRAY[
        '\x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
        '\x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199'
        -- ... 19个地址
    ],
    EXTRACT(EPOCH FROM NOW()),
    0
);
```

---

## 5. CI/CD集成

### 5.1 GitHub Actions工作流

```yaml
name: Guardian Tests

on:
  push:
    branches: [main, develop]
    paths:
      - 'guardians/**'
  pull_request:
    branches: [main, develop]
    paths:
      - 'guardians/**'

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Install Rust
        uses: actions-rs/toolchain@v1
        with:
          toolchain: stable
      
      - name: Cache cargo
        uses: actions/cache@v3
        with:
          path: ~/.cargo
          key: ${{ runner.os }}-cargo-${{ hashFiles('**/Cargo.lock') }}
      
      - name: Run unit tests
        run: |
          cd guardians
          cargo test --lib
      
      - name: Upload coverage
        run: |
          cargo tarpaulin --out Xml
          bash <(curl -s https://codecov.io/bash)
  
  integration-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_DB: bridge_test
          POSTGRES_USER: bridge
          POSTGRES_PASSWORD: test123
        ports:
          - 5432:5432
      
      redis:
        image: redis:7
        ports:
          - 6379:6379
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Install Rust
        uses: actions-rs/toolchain@v1
      
      - name: Start test chains
        run: |
          docker-compose -f docker-compose.test.yml up -d ethereum solana
      
      - name: Run integration tests
        env:
          POSTGRES_URL: postgresql://bridge:test123@localhost/bridge_test
          REDIS_URL: redis://localhost:6379
        run: |
          cd guardians
          cargo test --test integration_tests
  
  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Start test environment
        run: docker-compose -f docker-compose.test.yml up -d
      
      - name: Wait for services
        run: ./scripts/wait-for-services.sh
      
      - name: Run E2E tests
        run: |
          cd guardians
          cargo test --test e2e_tests -- --test-threads=1
      
      - name: Collect logs
        if: failure()
        run: |
          docker-compose -f docker-compose.test.yml logs > test-logs.txt
      
      - name: Upload artifacts
        if: failure()
        uses: actions/upload-artifact@v3
        with:
          name: test-logs
          path: test-logs.txt
```

---

### 5.2 测试报告

**生成Allure报告**:
```bash
# 安装Allure
cargo install cargo-allure

# 运行测试并生成报告
cargo test --all-features
cargo allure generate

# 查看报告
cargo allure open
```

**报告内容**:
- 测试用例执行结果
- 覆盖率统计
- 性能指标
- 失败用例详情
- 历史趋势对比

---

### 5.3 性能基准测试

```rust
use criterion::{black_box, criterion_group, criterion_main, Criterion};

fn benchmark_vaa_serialization(c: &mut Criterion) {
    let vaa = create_test_vaa();
    
    c.bench_function("vaa_serialize", |b| {
        b.iter(|| vaa.serialize())
    });
}

fn benchmark_signature_verification(c: &mut Criterion) {
    let message_hash = [0u8; 32];
    let signature = create_test_signature();
    
    c.bench_function("verify_signature", |b| {
        b.iter(|| verify_guardian_signature(
            black_box(message_hash),
            black_box(&signature),
            black_box(0)
        ))
    });
}

criterion_group!(benches, benchmark_vaa_serialization, benchmark_signature_verification);
criterion_main!(benches);
```

**运行基准测试**:
```bash
cargo bench
```

---

## 附录

### A. 测试用例优先级说明

| 优先级 | 说明 | 执行频率 |
|-------|------|---------|
| **P0** | 核心功能,必须通过才能发布 | 每次提交 |
| **P1** | 重要功能,影响用户体验 | 每日构建 |
| **P2** | 辅助功能,不影响核心流程 | 每周构建 |

---

### B. 测试环境清理

**每次测试后执行**:
```bash
# 清理数据库
docker-compose exec postgres psql -U bridge -d bridge_test -c "TRUNCATE TABLE observations, signatures, vaas CASCADE"

# 清理Redis
docker-compose exec redis redis-cli FLUSHDB

# 清理日志文件
rm -rf logs/*.log

# 重启Guardian节点
docker-compose restart guardian-0 guardian-1 guardian-2
```

---

### C. Mock工具

```rust
// Mock链监听器
pub struct MockWatcher {
    events: Vec<Observation>,
}

impl MockWatcher {
    pub fn new() -> Self {
        Self { events: Vec::new() }
    }
    
    pub fn add_event(&mut self, obs: Observation) {
        self.events.push(obs);
    }
    
    pub async fn watch(&self, tx: Sender<Observation>) {
        for event in &self.events {
            tx.send(event.clone()).await.unwrap();
        }
    }
}

// Mock P2P网络
pub struct MockP2P {
    messages: Arc<Mutex<Vec<Vec<u8>>>>,
}

impl MockP2P {
    pub fn new() -> Self {
        Self {
            messages: Arc::new(Mutex::new(Vec::new())),
        }
    }
    
    pub async fn publish(&self, message: Vec<u8>) {
        self.messages.lock().await.push(message);
    }
    
    pub async fn get_messages(&self) -> Vec<Vec<u8>> {
        self.messages.lock().await.clone()
    }
}
```

---

**文档状态**: ✅ v1.0 已完成  
**维护者**: Guardian测试团队  
**下次更新**: 根据开发进度同步更新

