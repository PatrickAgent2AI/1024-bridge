# 部署和初始化脚本

本目录包含用于在测试网（Devnet或自定义测试网）部署和初始化Solana Bridge的脚本。

---

## 📋 脚本列表

| 脚本 | 功能 | 使用场景 |
|------|------|---------|
| `initialize-testnet.ts` | 初始化Bridge和BridgeConfig | 首次部署后 |
| `verify-deployment.ts` | 验证部署和初始化状态 | 部署后检查 |
| `register-tokens.ts` | 注册TokenBinding示例 | 配置代币映射 |

---

## 🚀 快速开始

### 1. 部署到Devnet

```bash
# 步骤1: 配置环境
cd contracts/svm/bridge-programs
solana config set --url devnet
solana airdrop 2

# 步骤2: 编译和部署
anchor build
anchor deploy

# 步骤3: 初始化合约
yarn testnet:init

# 步骤4: 验证部署
yarn testnet:verify

# 步骤5: 注册代币（可选）
yarn testnet:register

# 步骤6: 运行测试
yarn testnet:test
```

### 2. 部署到自定义测试网

```bash
# 步骤1: 配置自定义RPC
export ANCHOR_PROVIDER_URL="https://your-custom-rpc.com"
export ANCHOR_WALLET="~/.config/solana/testnet-keypair.json"

# 步骤2: 确保有足够余额
solana config set --url https://your-custom-rpc.com
solana balance
# 如果余额不足，联系测试网管理员

# 步骤3: 编译和部署
anchor build
anchor deploy

# 步骤4-6: 同上
yarn testnet:init
yarn testnet:verify
yarn testnet:test
```

---

## 📝 脚本详细说明

### initialize-testnet.ts

**功能**: 初始化Bridge和BridgeConfig账户

**执行流程**:
1. 检查环境和余额
2. 初始化solana-core的Bridge和GuardianSet
3. 初始化token-bridge的BridgeConfig
4. 验证初始化结果

**使用方法**:

```bash
# 使用yarn命令
yarn testnet:init

# 或直接运行
ts-node scripts/initialize-testnet.ts

# 使用自定义RPC
ANCHOR_PROVIDER_URL=https://custom-rpc.com yarn testnet:init
```

**输出示例**:

```
============================================================
Solana Bridge 测试网初始化脚本
============================================================

环境信息:
  RPC URL: https://api.devnet.solana.com
  Wallet: 7vfC...voxs
  余额: 2.5 SOL

程序信息:
  solana-core: worm2Z...MTth
  token-bridge: wormDT...gUb

============================================================
步骤1: 初始化 solana-core
============================================================

⏳ 正在初始化Bridge...
  Guardian数量: 19
✅ Bridge初始化成功
  交易签名: 5Kcm...
  Bridge PDA: BCvM...Yvtc

============================================================
步骤2: 初始化 token-bridge
============================================================

⏳ 正在初始化BridgeConfig...
✅ BridgeConfig初始化成功
  BridgeConfig PDA: FmXt...

🎉 初始化完成！
```

### verify-deployment.ts

**功能**: 全面验证部署状态

**检查项**:
- ✅ 程序是否已部署
- ✅ Bridge是否已初始化
- ✅ Guardian Set是否配置
- ✅ BridgeConfig是否已初始化

**使用方法**:

```bash
yarn testnet:verify
```

### register-tokens.ts

**功能**: 注册TokenBinding示例（Solana USDC ↔ Ethereum USDC）

**执行流程**:
1. 创建测试USDC代币
2. 注册双向TokenBinding
3. 验证注册结果

**使用方法**:

```bash
yarn testnet:register
```

**修改建议**: 
编辑脚本中的代币地址和比率以注册实际需要的代币对。

---

## ⚙️ 环境变量配置

### 必需变量

```bash
# Anchor Provider URL（RPC地址）
export ANCHOR_PROVIDER_URL="https://your-custom-rpc.com"

# Anchor钱包路径
export ANCHOR_WALLET="~/.config/solana/testnet-keypair.json"
```

### 可选变量

```bash
# 程序ID（如果与默认不同）
export CORE_PROGRAM_ID="worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth"
export TOKEN_PROGRAM_ID="wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb"

# 测试配置
export USE_TESTNET=true
export TEST_TIMEOUT=300000
```

### 配置文件方式

创建 `.env` 文件：

```bash
ANCHOR_PROVIDER_URL=https://your-custom-rpc.com
ANCHOR_WALLET=~/.config/solana/testnet-keypair.json
USE_TESTNET=true
```

---

## 🔧 故障排查

### 问题1: 部署失败

```bash
# 检查余额
solana balance

# 需要至少3-5 SOL
# Devnet: solana airdrop 2
# 自定义网: 联系管理员

# 检查RPC连接
curl -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
  https://your-custom-rpc.com
```

### 问题2: 初始化失败

```bash
# 检查程序是否已部署
solana program show <PROGRAM_ID>

# 检查钱包权限
solana address

# 查看详细错误
yarn testnet:init 2>&1 | tee init.log
```

### 问题3: Program ID不匹配

```bash
# 查看实际部署的Program ID
anchor keys list

# 更新lib.rs中的declare_id!
# programs/solana-core/src/lib.rs
# programs/token-bridge/src/lib.rs

# 更新Anchor.toml
# [programs.testnet]部分

# 重新编译
anchor build
```

---

## 📚 相关文档

- [DEPLOYMENT.md](../DEPLOYMENT.md) - 完整部署指南
- [README.md](../README.md) - 项目概览
- [docs/API-SPEC.md](../docs/API-SPEC.md) - 接口规范
- [docs/PROGRESS.md](../docs/PROGRESS.md) - 开发进度

---

**维护者**: Solana合约开发团队  
**更新日期**: 2025-11-09


