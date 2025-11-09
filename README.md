# 跨链桥项目 (Multi-Signature Cross-Chain Bridge)

> 基于多签验证机制的去中心化跨链桥解决方案  
> 采用 Wormhole 架构模式，支持 EVM 链和 Solana 链之间的 ERC20/SPL 代币跨链转账  
> **创新特性**: TokenBinding机制支持跨链代币兑换（如USDC→USDT），支持多对多映射关系

---

## 📣 最新更新（v2.1 - 2025-11-09）

### TokenBinding机制上线

本项目采用创新的**代币绑定机制**（而非传统的包装代币模式）：

**核心特性**:
- ✅ **灵活兑换**: 支持不同币种间跨链兑换（USDC → USDT, DOGE → BTC等）
- ✅ **多对多映射**: 一个源代币可以绑定到多个目标代币，用户自由选择
- ✅ **去中心化配置**: 通过治理管理兑换比率
- ✅ **标准Payload**: 统一的157字节Payload格式，包含完整兑换信息
- ✅ **EVM/SVM对称**: 两个链上的实现完全对称

**示例**:
```
Ethereum USDC (1000枚) 
  → 跨链到Solana 
  → 用户选择目标代币: 
    ├─ Solana USDC (1000枚, rate=1:1)
    ├─ Solana USDT (998枚, rate=998:1000)
    └─ Solana DAI (1001枚, rate=1001:1000)
```

**技术文档**:
- [API规格说明书 v2.1](./docs/API-SPEC.md) - 新增TokenBinding数据结构和Payload格式
- [EVM子模块文档](./contracts/evm/docs/) - 完整的接口定义和测试计划
- [SVM子模块文档](./contracts/svm/docs/) - 与EVM功能对称的实现

---

## 📋 项目原理概要

### 核心架构

```
┌────────────────────────────────────────────────────────────────┐
│                        跨链转账流程                              │
│                                                                 │
│  用户 → 源链锁定代币 → Guardian监听验证 → VAA生成 →             │
│  Relayer提交 → 目标链验证 → 解锁/铸造代币 → 完成                │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│                      Guardian 共识机制                           │
│                                                                 │
│  19个独立Guardian节点监听源链事件                                │
│           ↓                                                     │
│  各自独立对消息签名                                              │
│           ↓                                                     │
│  通过P2P网络聚合签名                                             │
│           ↓                                                     │
│  达到13/19门限后生成VAA                                          │
│           ↓                                                     │
│  VAA可被任何Relayer获取并提交到目标链                            │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│                      跨链消息原子性保证                           │
│                                                                 │
│  阶段1 (源链):                                                   │
│    - 锁定/销毁代币 (不可逆)                                      │
│    - 发出LogMessagePublished事件                                │
│    - 区块确认后状态最终                                          │
│                                                                 │
│  阶段2 (Guardian):                                              │
│    - 13/19节点达成共识                                           │
│    - 生成签名的VAA (确定性)                                      │
│    - VAA永久有效，可重试                                         │
│                                                                 │
│  阶段3 (目标链):                                                 │
│    - 验证VAA签名                                                 │
│    - 防重放检查 (consumedVAAs)                                   │
│    - 解锁/铸造代币                                               │
│    - 标记VAA已消费                                               │
│                                                                 │
│  原子性保证:                                                     │
│    ✓ 源链操作完成后，VAA必然生成                                 │
│    ✓ VAA只能被消费一次                                           │
│    ✓ 失败可重试（用户或Relayer获取VAA重新提交）                   │
│    ✓ 多Relayer竞争，任一成功即可                                 │
└────────────────────────────────────────────────────────────────┘
```

---

### 关键术语

| 术语 | 说明 |
|------|------|
| **VAA** | Verified Action Approval - 经过13/19 Guardian多签验证的跨链消息 |
| **Guardian** | 验证器节点，独立监听链上事件并签名，通过P2P网络聚合签名 |
| **Relayer** | 消息中继服务，获取VAA并提交到目标链执行 |
| **Guardian Set** | Guardian集合及其版本号，支持升级和过期 |
| **Quorum** | 签名门限，13/19（68%+） |
| **TokenBinding** | 代币绑定映射机制，将源链代币绑定到目标链代币，支持不同币种间兑换（如USDC→USDT），支持多对多关系 |
| **Wrapped Token** | 目标链铸造的源链代币映射（非原生代币），如Ethereum USDC → Solana wrappedUSDC（注：本项目优先使用TokenBinding机制） |
| **Consistency Level** | 确认级别，交易需等待的区块数（1=即时, 15=安全, 200=最终确认） |

---

### 技术栈

| 组件 | 技术 | 版本 |
|------|------|------|
| **EVM 合约** | Solidity | 0.8.20+ |
| **Solana 程序** | Anchor | 0.29.0 |
| **Guardian 服务** | Rust | 1.75+ |
| **P2P 网络** | libp2p | 0.53+ |
| **数据库** | PostgreSQL + Redis | 15 + 7 |
| **测试框架** | Foundry + Anchor Test | latest |

---

### 链配置支持

系统通过配置文件支持对接任意EVM链和Solana链：

```yaml
# config.toml
[chains.evm.ethereum]
chain_id = 1
rpc_url = "https://eth.llamarpc.com"
core_contract = "0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B"
confirmations = 64

[chains.evm.bsc]
chain_id = 56
rpc_url = "https://bsc-dataseed.binance.org"
core_contract = "0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B"
confirmations = 15

[chains.svm.solana]
chain_id = 2
rpc_url = "https://api.mainnet-beta.solana.com"
core_program = "worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth"
confirmations = 32
```

---

### Guardian Set 跨链升级原子性

**问题**：两条链的Guardian Set必须同步升级，否则跨链消息验证失败

**解决方案 - 两阶段升级**：

```
阶段1: 预通知阶段 (Epoch N)
  - 链A: 提交新Guardian Set (索引N+1, 未激活)
  - 链B: 提交新Guardian Set (索引N+1, 未激活)
  - 旧Set继续工作
  - 等待两条链都确认

阶段2: 激活阶段 (Epoch N+1)
  - 统一时间点（区块高度或时间戳）
  - 链A: 激活新Set，旧Set进入过渡期
  - 链B: 激活新Set，旧Set进入过渡期
  - 过渡期内新旧Set都有效（7天）

阶段3: 完全迁移
  - 7天后旧Set完全失效
  - 只有新Set有效

保证：
✓ 升级期间跨链消息不中断
✓ 新旧消息都能验证
✓ 渐进式迁移，风险可控
```

---

## 🗂️ 文件目录结构

```
newlife/
├── README.md                          # 本文档：项目原理和目录说明
│
├── docs/                              # 📚 核心文档目录（只保留4个核心文档）
│   ├── API-SPEC.md                   # API规格：用户接口 + 模块间集成接口
│   ├── TEST-PLAN.md                  # 测试规划：宏观测试场景和用例
│   ├── PROGRESS.md                   # 进度追踪：开发和测试进度
│   └── (无其他文档)
│
├── contracts/                         # 📝 智能合约
│   ├── evm/                          # EVM链合约（Ethereum, BSC, Polygon等）
│   │   ├── src/                      # Solidity合约源码
│   │   ├── test/                     # Foundry测试
│   │   └── docs/                     # EVM子模块文档（4个）
│   └── svm/                          # Solana链程序
│       ├── programs/                 # Anchor程序（solana-core + token-bridge）
│       ├── tests/                    # Anchor测试
│       └── docs/                     # Solana子模块文档（4个）
│
├── guardians/                         # 🛡️ Guardian验证器服务(Workspace架构)
│   ├── guardian-core/                # 核心逻辑 + libp2p
│   ├── guardian-evm/                 # EVM链监听器 (ethers)
│   ├── guardian-solana/              # Solana链监听器 (solana-client)
│   ├── guardian-bin/                 # 主程序入口
│   ├── tests/                        # 集成测试和E2E测试
│   ├── config/                       # 配置文件模板
│   ├── scripts/                      # 工具脚本
│   ├── docs/                         # Guardian子模块文档（4个）
│   └── Cargo.toml                    # Workspace配置
├── relayer/                           # 🔄 Relayer中继服务
├── sdk/                               # 🔧 SDK工具库
├── cli/                               # 🖥️ 命令行工具
├── scripts/                           # 🔨 脚本工具
├── docker/                            # 🐳 Docker配置
├── .github/                           # 🔄 GitHub Actions CI/CD
│   └── workflows/
│       ├── test.yml                  # 测试流水线
│       ├── deploy-testnet.yml        # 测试网部署
│       └── security-audit.yml        # 安全审计
│
├── config/                            # ⚙️ 配置文件
│   ├── chains.toml.example           # 链配置模板
│   ├── guardian.toml.example         # Guardian配置模板
│   └── relayer.toml.example          # Relayer配置模板
│
├── .gitignore                         # Git忽略配置
├── .env.example                       # 环境变量模板
└── LICENSE                            # MIT开源协议
```

---

## 📚 核心文档说明

项目维护4个核心文档，分工明确：

### 1. API-SPEC.md
**内容**：
- 用户接口（合约公开函数、Guardian/Relayer REST API）
- 管理员接口（Guardian Set管理、紧急暂停）
- **模块间集成接口**：
  - 合约 ↔ Guardian：事件监听接口
  - Relayer ↔ 合约：交易提交接口
  - Relayer ↔ Guardian：VAA获取接口
- 接口鉴权设计
- 数据结构定义

### 2. TEST-PLAN.md
**内容**：
- 宏观测试场景（不关注实现细节）
- 核心测试内容：
  - Guardian/Relayer观测API测试
  - EVM/SVM合约用户接口测试
  - 接口鉴权测试
  - **跨链原子性测试**（重点）
  - **WrappedUSDC跨链完整流程测试**
  - **Guardian Set跨链升级原子性测试**

### 3. PROGRESS.md
**内容**：
- 开发任务分解和进度
- 测试用例执行进度
- 问题跟踪
- 每周更新

### 4. README.md（本文档）
**内容**：
- 项目原理概要
- 文件目录结构
- 每个文件/目录的作用

---

## 🔑 各文件/目录作用说明

### contracts/ - 智能合约

本目录包含两个子模块，每个子模块独立维护4个核心文档：

#### contracts/evm/ - EVM链合约（Foundry）
- **BridgeCore.sol**: 核心逻辑，消息收发、VAA验证、Guardian管理
- **TokenVault.sol**: ERC20代币锁定和解锁
- **WrappedToken.sol**: 包装代币合约，铸造/销毁
- **test/**: Foundry单元测试和集成测试
- **script/**: 部署和初始化脚本
- **docs/**: EVM子模块文档（API-SPEC.md, TEST-PLAN.md, PROGRESS.md, README.md）

#### contracts/svm/ - Solana链程序（Anchor）
- **programs/solana-core/**: 核心桥接程序，消息收发和VAA验证
- **programs/token-bridge/**: SPL代币桥，锁定/解锁/铸造/销毁
- **tests/**: Anchor测试套件
- **migrations/**: 部署脚本
- **docs/**: Solana子模块文档（API-SPEC.md, TEST-PLAN.md, PROGRESS.md, README.md）

### guardians/ - Guardian验证器(4-Crate架构)
采用 Workspace + 精简 Crate 设计以解决 libp2p/ethers/solana-client 依赖冲突:
- **guardian-core/**: 核心逻辑(类型、P2P、签名、聚合、存储、API) + libp2p
  - `src/types/`: VAA、Observation、Signature、Guardian Set
  - `src/config/`: Guardian配置、链配置管理
  - `src/p2p/`: libp2p网络，Guardian间P2P通信
  - `src/signer/`: ECDSA签名生成、验证、聚合
  - `src/storage/`: PostgreSQL存储VAA，Redis缓存
  - `src/api/`: REST API服务(Axum)
  - `src/utils/`: 加密、编码、时间工具
- **guardian-evm/**: EVM链监听器，只依赖 ethers + guardian-core types
  - 监听 Ethereum、BSC 等链的 LogMessagePublished 事件
  - 通过消息通道将观察记录发送到 core
- **guardian-solana/**: Solana链监听器，只依赖 solana-client + guardian-core types
  - 监听 Solana 程序日志
  - 通过消息通道将观察记录发送到 core
- **guardian-bin/**: 主程序入口，组合所有crate启动Guardian节点
- **docs/**: Guardian子模块文档（API-SPEC.md, TEST-PLAN.md, PROGRESS.md, README.md）

**依赖隔离策略**: guardian-evm 和 guardian-solana 互不依赖,只通过 guardian-core 的类型定义通信,避免三方依赖冲突

### relayer/ - 消息中继
- **config/**: 链配置管理
- **fetcher/**: 从Guardian API获取已签名的VAA
- **submitter/**: 提交VAA到目标链合约
- **gas_manager.rs**: Gas估算和优化
- **queue.rs**: 任务队列，处理待提交的VAA
- **api/**: 对外REST API，提供任务状态查询

### sdk/ - 开发工具包
- **typescript/**: 前端/Node.js集成，提供Bridge客户端和VAA工具
- **rust/**: 后端服务集成，提供Rust类型定义和工具

### cli/ - 命令行工具
- 用于手动操作：获取VAA、提交VAA、查询状态
- 管理员工具：Guardian管理、紧急操作

### scripts/ - 自动化脚本
- **deploy/**: 自动化部署合约和启动服务
- **test/**: 测试环境搭建和执行
- **utils/**: 密钥生成、健康检查等工具

### docker/ - 容器化
- 完整的Docker Compose配置
- 支持本地开发、测试、生产环境

### config/ - 配置文件
- **chains.toml**: 定义支持的EVM和SVM链
- **guardian.toml**: Guardian节点配置
- **relayer.toml**: Relayer服务配置

---

**项目状态**: Phase 1 已完成（需求分析与设计），Phase 2 进行中（合约开发）

**详细进度**: 查看 [PROGRESS.md](./docs/PROGRESS.md)
