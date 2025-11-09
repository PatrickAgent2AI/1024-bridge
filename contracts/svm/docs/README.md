# Solana 合约子模块 - README

> **模块名称**: Solana Bridge Programs  
> **框架**: Anchor 0.29.0  
> **创建日期**: 2025-11-08

---

## 📋 模块概要

### 1. 模块设计

本子模块实现基于Anchor框架的Solana跨链桥接程序，是整个跨链桥系统的Solana端实现。

**核心功能**:
- 接收来自EVM链的跨链消息（通过VAA验证）
- 发送跨链消息到EVM链
- 管理SPL代币的锁定/解锁/铸造/销毁
- 同步Guardian Set升级

---

### 2. 架构原理

#### 2.1 跨链消息流

```
发送流程 (Solana → EVM):
┌─────────────────────────────────────────────────────────────┐
│ 1. 用户调用 token_bridge.transfer_tokens                    │
│    - 锁定SPL代币到custody账户                                │
│    - 构造TokenTransfer payload                              │
│                                                             │
│ 2. token_bridge调用 solana_core.post_message                │
│    - 创建PostedMessage账户                                  │
│    - 序列号递增                                             │
│    - 发出交易日志                                           │
│                                                             │
│ 3. Guardian监听Solana交易日志                               │
│    - 解析MessagePublished日志                               │
│    - 签名并聚合（13/19门限）                                │
│    - 生成VAA                                                │
│                                                             │
│ 4. Relayer获取VAA并提交到EVM链                             │
│    - 调用EVM BridgeCore.receiveMessage(vaa)                 │
│    - 解锁或铸造ERC20代币                                    │
└─────────────────────────────────────────────────────────────┘

接收流程 (EVM → Solana):
┌─────────────────────────────────────────────────────────────┐
│ 1. EVM链发送消息，Guardian生成VAA                           │
│                                                             │
│ 2. Relayer使用三步骤提交VAA到Solana:                        │
│    a) init_vaa_buffer(vaa_size)                             │
│       - 创建VaaBuffer账户                                   │
│    b) append_vaa_chunk(chunk, offset) × N                   │
│       - 分块写入VAA数据（每块≤900字节）                     │
│    c) post_vaa()                                            │
│       - 从VaaBuffer读取完整VAA                              │
│       - 验证Guardian签名（13/19门限）                       │
│       - 检查Guardian Set有效性                              │
│       - 防重放检查                                          │
│       - 创建PostedVAA账户                                   │
│                                                             │
│ 3. 用户/Relayer调用 token_bridge.complete_transfer()        │
│    - 从PostedVAA读取payload                                 │
│    - 解析TokenTransfer payload                              │
│    - 判断原生/包装代币                                      │
│    - 解锁或铸造SPL代币                                      │
│    - 标记VAA已消费                                          │
└─────────────────────────────────────────────────────────────┘
```

---

#### 2.2 Guardian Set 升级机制

```
升级流程:
┌─────────────────────────────────────────────────────────────┐
│ 阶段1: 预通知阶段                                            │
│   - Ethereum先升级Guardian Set                              │
│   - 生成升级VAA（由旧Set签名）                              │
│   - Solana接收升级VAA                                       │
│   - 创建新GuardianSet账户（索引+1）                         │
│   - 旧Set设置过期时间（7天后）                              │
│                                                             │
│ 阶段2: 过渡期（7天）                                         │
│   - 新旧两个GuardianSet都有效                               │
│   - 接受旧Set索引的VAA                                      │
│   - 接受新Set索引的VAA                                      │
│   - 保证跨链消息不中断                                      │
│                                                             │
│ 阶段3: 完全迁移                                              │
│   - 7天后旧Set过期                                          │
│   - 只接受新Set索引的VAA                                    │
│   - 升级完成                                                │
└─────────────────────────────────────────────────────────────┘
```

**原子性保证**:
- Ethereum和Solana使用相同的升级VAA
- 过渡期确保不会因时间差导致验证失败
- 新旧Set并存期间跨链消息正常工作

---

#### 2.3 VAA验证机制

```rust
// VAA验证步骤
pub fn verify_vaa(vaa: &VAA, guardian_set: &GuardianSet) -> Result<()> {
    // 1. 检查Guardian Set未过期
    require!(
        guardian_set.expiration_time == 0 || 
        now < guardian_set.expiration_time,
        BridgeError::GuardianSetExpired
    );
    
    // 2. 检查签名数量达到门限
    require!(
        vaa.signatures.len() >= 13,
        BridgeError::InsufficientSignatures
    );
    
    // 3. 验证每个签名
    let body_hash = keccak256(&vaa.body);
    for sig in &vaa.signatures {
        let guardian = guardian_set.guardians[sig.index];
        verify_signature(body_hash, sig, guardian)?;
    }
    
    // 4. 防重放检查
    require!(
        !posted_vaa.consumed,
        BridgeError::VAAAlreadyConsumed
    );
    
    Ok(())
}
```

---

### 3. 程序结构

#### 3.1 solana-core程序

**职责**: 核心桥接逻辑，消息收发和验证

**关键指令**:
- `initialize`: 初始化Bridge和Guardian Set
- `post_message`: 发送跨链消息
- `post_vaa`: 接收并验证VAA
- `update_guardian_set`: 升级Guardian Set
- `set_paused`: 紧急暂停

**账户结构**:
- `Bridge`: 存储当前Guardian Set索引、手续费、暂停状态
- `GuardianSet`: 存储Guardian公钥列表、过期时间
- `PostedMessage`: 存储发送的消息
- `PostedVAA`: 存储接收的VAA
- `Sequence`: 存储每个emitter的序列号

---

#### 3.2 token-bridge程序

**职责**: SPL代币的跨链转账

**关键指令**:
- `transfer_tokens`: 锁定SPL代币并发起跨链
- `complete_transfer`: 完成跨链转账（解锁或铸造）
- `create_wrapped`: 创建包装SPL代币

**账户结构**:
- `WrappedMeta`: 存储包装代币的原链信息
- Token Accounts: SPL Token账户（custody、user accounts）

---

## 🗂️ 目录结构

```
contracts/svm/
├── docs/                          # 📚 子模块文档
│   ├── API-SPEC.md               # Solana程序接口规范
│   ├── TEST-PLAN.md              # Solana程序测试套件
│   ├── PROGRESS.md               # 开发与测试进度
│   └── README.md                 # 本文档
│
├── programs/                      # 📝 Anchor程序
│   ├── solana-core/              # 核心桥接程序
│   │   ├── src/
│   │   │   ├── lib.rs            # 程序入口
│   │   │   ├── instructions/     # 指令实现
│   │   │   │   ├── initialize.rs
│   │   │   │   ├── post_message.rs
│   │   │   │   ├── post_vaa.rs
│   │   │   │   └── update_guardian_set.rs
│   │   │   ├── state/            # 账户结构
│   │   │   │   ├── bridge.rs
│   │   │   │   ├── guardian_set.rs
│   │   │   │   ├── posted_message.rs
│   │   │   │   └── posted_vaa.rs
│   │   │   ├── error.rs          # 错误定义
│   │   │   └── utils.rs          # 工具函数
│   │   └── Cargo.toml
│   │
│   └── token-bridge/             # 代币桥程序
│       ├── src/
│       │   ├── lib.rs            # 程序入口
│       │   ├── instructions/     # 指令实现
│       │   │   ├── transfer_tokens.rs
│       │   │   ├── complete_transfer.rs
│       │   │   └── create_wrapped.rs
│       │   ├── state/            # 账户结构
│       │   │   └── wrapped_meta.rs
│       │   └── error.rs
│       └── Cargo.toml
│
├── tests/                         # 🧪 测试
│   ├── solana-core.test.ts       # solana-core单元测试
│   ├── token-bridge.test.ts      # token-bridge单元测试
│   ├── integration.test.ts       # 集成测试
│   └── utils/                    # 测试工具
│       ├── helpers.ts            # 辅助函数
│       ├── vaa.ts                # VAA构造工具
│       └── setup.ts              # 测试环境设置
│
├── migrations/                    # 📦 部署脚本
│   └── deploy.ts
│
├── target/                        # 🔨 编译输出（.gitignore）
├── Anchor.toml                    # Anchor配置
├── Cargo.toml                     # Workspace配置
├── package.json                   # Node.js依赖
└── tsconfig.json                  # TypeScript配置
```

---

## 📚 文档说明

本子模块维护4个核心文档：

### 1. API-SPEC.md
**内容**:
- Solana程序的所有指令接口
- 账户结构定义
- Payload格式定义
- 错误码规范
- 与Guardian/Relayer的集成接口

**适用对象**: 前端开发者、集成方、测试工程师

---

### 2. TEST-PLAN.md
**内容**:
- 程序单元测试（30个用例）
- 程序集成测试（12个用例）
- 跨链E2E测试（5个场景）
- 测试环境配置
- CI/CD配置

**适用对象**: 测试工程师、QA团队

---

### 3. PROGRESS.md
**内容**:
- 开发任务分解（18个任务）
- 测试进度追踪
- 问题跟踪
- 每周更新

**适用对象**: 项目经理、开发团队

---

### 4. README.md（本文档）
**内容**:
- 模块设计原理
- 架构说明
- 目录结构
- 文档说明

**适用对象**: 新成员、架构师

---

## 🔑 各文件/目录作用

### programs/ - Anchor程序源码

#### solana-core/
**核心桥接程序**，实现跨链消息的收发和验证

**关键文件**:
- `lib.rs`: 程序入口，声明程序ID和导出指令
- `instructions/initialize.rs`: 初始化Bridge和Guardian Set
- `instructions/post_message.rs`: 发送跨链消息
- `instructions/post_vaa.rs`: 接收并验证VAA
- `instructions/update_guardian_set.rs`: 升级Guardian Set
- `state/bridge.rs`: Bridge账户结构
- `state/guardian_set.rs`: GuardianSet账户结构
- `error.rs`: 程序错误定义

---

#### token-bridge/
**代币桥程序**，实现SPL代币的跨链转账

**关键文件**:
- `lib.rs`: 程序入口
- `instructions/transfer_tokens.rs`: 锁定SPL代币并发起跨链
- `instructions/complete_transfer.rs`: 完成跨链转账（解锁或铸造）
- `instructions/create_wrapped.rs`: 创建包装SPL代币
- `state/wrapped_meta.rs`: WrappedMeta账户结构
- `error.rs`: 程序错误定义

---

### tests/ - 测试套件

**测试文件**:
- `solana-core.test.ts`: solana-core的单元测试（20个用例）
- `token-bridge.test.ts`: token-bridge的单元测试（12个用例）
- `integration.test.ts`: 集成测试（6个场景）
- `utils/helpers.ts`: 测试辅助函数（账户创建、代币铸造等）
- `utils/vaa.ts`: VAA构造工具
- `utils/setup.ts`: 测试环境初始化

**测试运行**:
```bash
# 运行所有测试
anchor test

# 运行单个测试文件
anchor test tests/solana-core.test.ts

# 生成覆盖率报告
anchor coverage
```

---

### migrations/ - 部署脚本

**deploy.ts**: Anchor部署脚本，自动化部署程序到目标网络

```typescript
// 部署到localnet
anchor deploy

// 部署到devnet
anchor deploy --provider.cluster devnet

// 部署到mainnet
anchor deploy --provider.cluster mainnet
```

---

### 配置文件

#### Anchor.toml
```toml
[features]
seeds = false
skip-lint = false

[programs.localnet]
solana_core = "worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth"
token_bridge = "wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb"

[programs.devnet]
solana_core = "worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth"
token_bridge = "wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb"

[scripts]
test = "yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts"
```

#### Cargo.toml (Workspace)
```toml
[workspace]
members = [
    "programs/solana-core",
    "programs/token-bridge"
]
```

---

## 🚀 快速开始

### 1. 安装依赖

```bash
# 安装Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"

# 安装Anchor
cargo install --git https://github.com/coral-xyz/anchor anchor-cli --locked

# 安装Node.js依赖
cd contracts/svm
yarn install
```

---

### 2. 构建程序

```bash
# 构建所有程序
anchor build

# 检查程序ID
solana address -k target/deploy/solana_core-keypair.json
solana address -k target/deploy/token_bridge-keypair.json

# 更新程序ID到lib.rs
anchor keys sync
```

---

### 3. 运行测试

```bash
# 启动本地验证器
solana-test-validator

# 运行测试
anchor test --skip-local-validator
```

---

### 4. 部署程序

```bash
# 部署到localnet
anchor deploy

# 部署到devnet
anchor deploy --provider.cluster devnet
```

---

## 📊 开发状态

| 组件 | 状态 | 完成度 |
|------|------|--------|
| **solana-core程序** | 📅 未开始 | 0% |
| ├─ 账户结构定义 | 📅 | 0% |
| ├─ initialize指令 | 📅 | 0% |
| ├─ post_message指令 | 📅 | 0% |
| ├─ post_vaa指令 | 📅 | 0% |
| └─ update_guardian_set指令 | 📅 | 0% |
| **token-bridge程序** | 📅 未开始 | 0% |
| ├─ 账户结构定义 | 📅 | 0% |
| ├─ transfer_tokens指令 | 📅 | 0% |
| ├─ complete_transfer指令 | 📅 | 0% |
| └─ create_wrapped指令 | 📅 | 0% |
| **测试套件** | 📅 未开始 | 0% |
| ├─ 单元测试(30个) | 📅 | 0% |
| ├─ 集成测试(12个) | 📅 | 0% |
| └─ E2E测试(5个) | 📅 | 0% |

**详细进度**: 查看 [PROGRESS.md](./PROGRESS.md)

---

## 🔗 相关资源

### 内部文档
- [API规格说明](./API-SPEC.md) - Solana程序接口规范
- [测试套件规划](./TEST-PLAN.md) - 测试用例和测试环境
- [开发进度](./PROGRESS.md) - 任务分解和进度追踪

### 父项目文档
- [父项目README](../../../README.md) - 整体架构说明
- [父项目API-SPEC](../../../docs/API-SPEC.md) - 完整系统接口
- [父项目TEST-PLAN](../../../docs/TEST-PLAN.md) - 系统测试规划

### 外部参考
- [Anchor官方文档](https://www.anchor-lang.com/)
- [Solana文档](https://docs.solana.com/)
- [Wormhole Solana实现](https://github.com/wormhole-foundation/wormhole/tree/main/solana)

---

**模块状态**: 📅 等待启动  
**预计开始时间**: 2025-11-18  
**维护者**: Solana合约开发团队

