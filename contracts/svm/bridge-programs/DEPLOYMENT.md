# Solana合约测试网部署指南

> **文档版本**: v1.0  
> **创建日期**: 2025-11-09  
> **适用环境**: Devnet / 自定义测试网

---

## 📋 目录

1. [环境配置](#1-环境配置)
2. [部署到Devnet](#2-部署到devnet)
3. [部署到自定义测试网](#3-部署到自定义测试网)
4. [运行测试](#4-运行测试)
5. [常见问题](#5-常见问题)

---

## 1. 环境配置

### 1.1 前置要求

```bash
# 检查版本
solana --version    # >= 1.18.0
anchor --version    # >= 0.30.0
node --version      # >= 18.0
```

### 1.2 配置钱包

```bash
# 方式1: 使用现有钱包
export ANCHOR_WALLET=~/.config/solana/id.json

# 方式2: 生成新钱包（用于测试）
solana-keygen new --outfile ~/.config/solana/testnet-keypair.json
export ANCHOR_WALLET=~/.config/solana/testnet-keypair.json
```

---

## 2. 部署到Devnet

### 2.1 配置Devnet环境

**步骤1: 修改Anchor.toml**

```bash
cd contracts/svm/bridge-programs
```

编辑 `Anchor.toml`:

```toml
[provider]
cluster = "devnet"  # 修改这里
wallet = "~/.config/solana/id.json"

[programs.devnet]  # 添加devnet配置
solana_core = "worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth"
token_bridge = "wormDTUJ6AWPNvk59vGQbDTdgWgAqcLBCgUb"
```

**步骤2: 切换到Devnet**

```bash
solana config set --url devnet
```

**步骤3: 空投测试SOL**

```bash
# 给部署钱包空投
solana airdrop 2

# 验证余额
solana balance
```

### 2.2 编译和部署

```bash
# 1. 编译程序
anchor build

# 2. 部署到Devnet
anchor deploy

# 3. 记录部署的Program ID
solana program show <PROGRAM_ID>
```

### 2.3 更新Program ID (如果需要)

如果Program ID与Anchor.toml不一致，需要更新：

```bash
# 1. 查看部署的Program ID
anchor keys list

# 2. 更新lib.rs中的declare_id!
# programs/solana-core/src/lib.rs
declare_id!("新的Program ID");

# 3. 更新Anchor.toml
[programs.devnet]
solana_core = "新的Program ID"

# 4. 重新编译
anchor build

# 5. 使用upgrade部署（保留数据）
anchor upgrade <PROGRAM_PATH> --program-id <PROGRAM_ID>
```

### 2.4 初始化合约

创建初始化脚本 `scripts/initialize-devnet.ts`:

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";

async function main() {
  // 连接到Devnet
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const coreProgram = anchor.workspace.SolanaCore;
  const tokenProgram = anchor.workspace.TokenBridge;

  console.log("初始化Bridge...");

  // 准备Guardian地址（使用真实Guardian或测试Guardian）
  const guardians = [
    // 填入19个Guardian的Ethereum地址（20字节）
    [0x67, 0x37, 0x4c, 0xbc, ...],
    // ... 共19个
  ];

  const [bridgePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("Bridge")],
    coreProgram.programId
  );

  const [guardianSetPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("GuardianSet"), Buffer.from([0, 0, 0, 0])],
    coreProgram.programId
  );

  // 初始化solana-core
  await coreProgram.methods
    .initialize(0, guardians, new anchor.BN(1_000_000))
    .accounts({
      bridge: bridgePda,
      guardianSet: guardianSetPda,
      payer: provider.wallet.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  console.log("Bridge初始化成功");
  console.log("Bridge PDA:", bridgePda.toString());

  // 初始化token-bridge
  const [bridgeConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("BridgeConfig")],
    tokenProgram.programId
  );

  await tokenProgram.methods
    .initialize(provider.wallet.publicKey)
    .accounts({
      bridgeConfig: bridgeConfigPda,
      payer: provider.wallet.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  console.log("BridgeConfig初始化成功");
  console.log("BridgeConfig PDA:", bridgeConfigPda.toString());
}

main().catch(console.error);
```

运行初始化：

```bash
ts-node scripts/initialize-devnet.ts
```

---

## 3. 部署到自定义测试网

### 3.1 配置自定义RPC

**方式1: 修改Anchor.toml**

```toml
[provider]
cluster = "https://your-custom-rpc.com"  # 自定义RPC URL
wallet = "~/.config/solana/testnet-keypair.json"

[programs.testnet]  # 新增testnet配置
solana_core = "worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth"
token_bridge = "wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb"
```

**方式2: 使用环境变量**

```bash
# 设置RPC URL
export ANCHOR_PROVIDER_URL="https://your-custom-rpc.com"

# 设置钱包路径
export ANCHOR_WALLET="~/.config/solana/testnet-keypair.json"
```

### 3.2 配置Solana CLI

```bash
# 设置自定义RPC
solana config set --url https://your-custom-rpc.com

# 验证配置
solana config get

# 查看余额
solana balance

# 如果余额不足，联系测试网管理员空投
```

### 3.3 部署流程

```bash
# 1. 编译
anchor build

# 2. 部署（使用环境变量中的RPC）
anchor deploy

# 或者显式指定RPC
anchor deploy --provider.cluster https://your-custom-rpc.com

# 3. 验证部署
solana program show <PROGRAM_ID>
```

### 3.4 为测试网生成新的Program ID

如果需要使用测试网专用的Program ID：

```bash
# 1. 生成新的密钥对
solana-keygen new --outfile target/deploy/solana_core-keypair.json
solana-keygen new --outfile target/deploy/token_bridge-keypair.json

# 2. 查看新的Program ID
solana-keygen pubkey target/deploy/solana_core-keypair.json
solana-keygen pubkey target/deploy/token_bridge-keypair.json

# 3. 更新lib.rs中的declare_id!
# programs/solana-core/src/lib.rs
declare_id!("新的solana_core Program ID");

# programs/token-bridge/src/lib.rs
declare_id!("新的token_bridge Program ID");

# 4. 更新Anchor.toml
[programs.testnet]
solana_core = "新的solana_core Program ID"
token_bridge = "新的token_bridge Program ID"

# 5. 重新编译和部署
anchor build
anchor deploy --provider.cluster https://your-custom-rpc.com
```

---

## 4. 运行测试

### 4.1 配置测试环境

创建测试配置文件 `tests/testnet.config.ts`:

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Connection } from "@solana/web3.js";

export const TESTNET_CONFIG = {
  // 自定义RPC URL
  rpcUrl: process.env.TESTNET_RPC || "https://your-custom-rpc.com",
  
  // 测试网Program ID
  coreProgramId: process.env.CORE_PROGRAM_ID || "worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth",
  tokenProgramId: process.env.TOKEN_PROGRAM_ID || "wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb",
  
  // 测试账户
  payerKeypair: process.env.TESTNET_PAYER_PATH || "~/.config/solana/testnet-keypair.json",
};

export function getTestnetConnection(): Connection {
  return new Connection(TESTNET_CONFIG.rpcUrl, "confirmed");
}
```

### 4.2 修改测试脚本

在测试文件顶部添加环境检测：

```typescript
// tests/unit/solana-core.test.ts
import { getTestnetConnection, TESTNET_CONFIG } from "../testnet.config";

describe("solana-core 测试网测试", () => {
  let connection: Connection;
  let provider: AnchorProvider;

  before(async () => {
    // 根据环境变量选择RPC
    if (process.env.USE_TESTNET) {
      connection = getTestnetConnection();
      console.log("使用测试网:", TESTNET_CONFIG.rpcUrl);
    } else {
      connection = anchor.getProvider().connection;
      console.log("使用本地网络");
    }

    provider = new AnchorProvider(
      connection,
      anchor.AnchorProvider.env().wallet,
      { commitment: "confirmed" }
    );
    anchor.setProvider(provider);
  });

  // ... 测试用例
});
```

### 4.3 运行测试

**方式1: 使用环境变量**

```bash
# 设置测试网环境
export USE_TESTNET=true
export TESTNET_RPC="https://your-custom-rpc.com"
export CORE_PROGRAM_ID="deployed_core_program_id"
export TOKEN_PROGRAM_ID="deployed_token_program_id"

# 运行单元测试
yarn test:unit

# 运行集成测试
yarn test:integration

# 运行特定测试文件
ts-mocha -p ./tsconfig.json tests/unit/token-bridge.test.ts
```

**方式2: 使用配置文件**

创建 `.env` 文件：

```bash
USE_TESTNET=true
TESTNET_RPC=https://your-custom-rpc.com
CORE_PROGRAM_ID=worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth
TOKEN_PROGRAM_ID=wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb
TESTNET_PAYER_PATH=~/.config/solana/testnet-keypair.json
```

安装dotenv：

```bash
yarn add dotenv
```

在测试文件开头加载：

```typescript
import 'dotenv/config';
```

**方式3: 修改Anchor.toml直接测试**

```bash
# 1. 修改Anchor.toml的cluster配置
[provider]
cluster = "https://your-custom-rpc.com"

# 2. 运行测试（会自动使用配置的RPC）
anchor test --skip-local-validator

# 注意：--skip-local-validator跳过启动本地验证器
```

### 4.4 针对测试网的测试优化

创建 `tests/testnet-suite.test.ts`:

```typescript
import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";

describe("测试网快速验证", () => {
  const connection = new Connection(
    process.env.TESTNET_RPC || "https://api.devnet.solana.com",
    "confirmed"
  );

  it("验证程序部署状态", async () => {
    const coreProgramId = new PublicKey(process.env.CORE_PROGRAM_ID || "...");
    const tokenProgramId = new PublicKey(process.env.TOKEN_PROGRAM_ID || "...");

    // 检查程序是否存在
    const coreInfo = await connection.getAccountInfo(coreProgramId);
    const tokenInfo = await connection.getAccountInfo(tokenProgramId);

    expect(coreInfo).to.not.be.null;
    expect(tokenInfo).to.not.be.null;
    expect(coreInfo?.executable).to.be.true;
    expect(tokenInfo?.executable).to.be.true;

    console.log("✅ solana-core程序已部署");
    console.log("✅ token-bridge程序已部署");
  });

  it("验证Bridge初始化状态", async () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const coreProgram = anchor.workspace.SolanaCore;
    const [bridgePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("Bridge")],
      coreProgram.programId
    );

    try {
      const bridge = await coreProgram.account.bridge.fetch(bridgePda);
      console.log("✅ Bridge已初始化");
      console.log("  Guardian Set Index:", bridge.guardianSetIndex);
      console.log("  Message Fee:", bridge.messageFee.toString());
      console.log("  Paused:", bridge.paused);
    } catch (e) {
      console.log("⚠️ Bridge未初始化，请先运行初始化脚本");
    }
  });
});
```

运行验证：

```bash
ts-mocha -p ./tsconfig.json tests/testnet-suite.test.ts
```

---

## 3. 部署到自定义测试网

### 3.1 自定义测试网要求

您的自定义测试网RPC需要满足：

| 要求 | 说明 |
|------|------|
| **兼容性** | 支持Solana JSON-RPC API |
| **版本** | >= 1.18.0 |
| **功能** | 支持getAccountInfo, sendTransaction, getLatestBlockhash等 |
| **预编译** | 支持secp256k1_recover指令（VAA验证必需） |

### 3.2 完整部署流程

**步骤1: 准备钱包并充值**

```bash
# 切换到自定义RPC
solana config set --url https://your-custom-rpc.com

# 查看地址
solana address

# 联系测试网管理员空投SOL（或使用测试网水龙头）
# 建议至少5 SOL用于部署和测试
```

**步骤2: 配置Anchor.toml**

```toml
[toolchain]
package_manager = "yarn"

[features]
resolution = true
skip-lint = false

[workspace]
types = "trident"

# === 本地开发配置 ===
[programs.localnet]
solana_core = "worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth"
token_bridge = "wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb"

# === Devnet配置 ===
[programs.devnet]
solana_core = "worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth"
token_bridge = "wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb"

# === 自定义测试网配置 ===
[programs.testnet]
solana_core = "worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth"
token_bridge = "wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb"

[registry]
url = "https://api.apr.dev"

[provider]
cluster = "https://your-custom-rpc.com"  # 自定义RPC
wallet = "~/.config/solana/testnet-keypair.json"

[scripts]
test = "yarn run ts-mocha -p ./tsconfig.json -t 1000000 \"tests/**/*.ts\""
```

**步骤3: 编译和部署**

```bash
# 清理缓存
anchor clean

# 编译
anchor build

# 部署到自定义测试网
anchor deploy \
  --provider.cluster https://your-custom-rpc.com \
  --provider.wallet ~/.config/solana/testnet-keypair.json

# 验证部署
solana program show worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth
solana program show wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb
```

**步骤4: 初始化合约**

```bash
# 运行初始化脚本
ts-node scripts/initialize-testnet.ts
```

### 3.3 验证部署

创建验证脚本 `scripts/verify-deployment.ts`:

```typescript
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

async function verify() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  console.log("RPC URL:", provider.connection.rpcEndpoint);
  console.log("Wallet:", provider.wallet.publicKey.toString());

  const coreProgram = anchor.workspace.SolanaCore;
  const tokenProgram = anchor.workspace.TokenBridge;

  // 检查程序
  console.log("\n=== 程序部署状态 ===");
  console.log("solana-core ID:", coreProgram.programId.toString());
  console.log("token-bridge ID:", tokenProgram.programId.toString());

  const coreInfo = await provider.connection.getAccountInfo(coreProgram.programId);
  const tokenInfo = await provider.connection.getAccountInfo(tokenProgram.programId);

  console.log("solana-core:", coreInfo ? "✅ 已部署" : "❌ 未找到");
  console.log("token-bridge:", tokenInfo ? "✅ 已部署" : "❌ 未找到");

  // 检查Bridge初始化
  console.log("\n=== Bridge初始化状态 ===");
  const [bridgePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("Bridge")],
    coreProgram.programId
  );

  try {
    const bridge = await coreProgram.account.bridge.fetch(bridgePda);
    console.log("✅ Bridge已初始化");
    console.log("  Guardian Set Index:", bridge.guardianSetIndex);
    console.log("  Message Fee:", bridge.messageFee.toNumber() / 1e9, "SOL");
    console.log("  Paused:", bridge.paused);

    const [guardianSetPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("GuardianSet"), Buffer.from([0, 0, 0, 0])],
      coreProgram.programId
    );
    const guardianSet = await coreProgram.account.guardianSet.fetch(guardianSetPda);
    console.log("  Guardian数量:", guardianSet.guardians.length);
  } catch (e) {
    console.log("⚠️ Bridge未初始化");
  }

  // 检查BridgeConfig
  console.log("\n=== BridgeConfig状态 ===");
  const [bridgeConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("BridgeConfig")],
    tokenProgram.programId
  );

  try {
    const config = await tokenProgram.account.bridgeConfig.fetch(bridgeConfigPda);
    console.log("✅ BridgeConfig已初始化");
    console.log("  Authority:", config.authority.toString());
    console.log("  Exchange Enabled:", config.exchangeEnabled);
  } catch (e) {
    console.log("⚠️ BridgeConfig未初始化");
  }
}

verify().catch(console.error);
```

运行验证：

```bash
ts-node scripts/verify-deployment.ts
```

### 4.4 在测试网运行测试

**完整测试流程**:

```bash
# 1. 确保环境变量已设置
export ANCHOR_PROVIDER_URL="https://your-custom-rpc.com"
export ANCHOR_WALLET="~/.config/solana/testnet-keypair.json"

# 2. 验证部署
ts-node scripts/verify-deployment.ts

# 3. 运行测试（跳过本地验证器）
anchor test --skip-local-validator

# 或者分步运行
anchor build
anchor deploy
yarn test:unit
yarn test:integration
```

**针对测试网优化测试超时**:

修改 `package.json`:

```json
{
  "scripts": {
    "test:testnet": "ts-mocha -p ./tsconfig.json -t 3000000 'tests/unit/**/*.test.ts'",
    "test:testnet:integration": "ts-mocha -p ./tsconfig.json -t 3000000 'tests/integration/**/*.test.ts'"
  }
}
```

运行：

```bash
yarn test:testnet
```

---

## 5. 常见问题

### 5.1 部署相关

**Q: 部署失败，提示余额不足**

```bash
# 检查余额
solana balance

# 需要至少3-5 SOL用于部署
# 联系测试网管理员空投或使用水龙头
```

**Q: Program ID不匹配**

```bash
# 1. 查看部署的实际Program ID
anchor keys list

# 2. 更新declare_id!
# 编辑 programs/*/src/lib.rs

# 3. 更新Anchor.toml
# 编辑 [programs.testnet] 部分

# 4. 重新编译
anchor build

# 5. 升级部署（保留已初始化的数据）
anchor upgrade target/deploy/solana_core.so \
  --program-id <ACTUAL_PROGRAM_ID> \
  --provider.cluster https://your-custom-rpc.com
```

### 5.2 测试相关

**Q: 测试超时**

```bash
# 增加测试超时时间
ts-mocha -p ./tsconfig.json -t 3000000 tests/unit/*.test.ts

# 或修改package.json的test命令
```

**Q: RPC连接错误**

```bash
# 测试RPC连接
curl -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
  https://your-custom-rpc.com

# 检查RPC是否支持必要的方法
```

**Q: 账户不存在错误**

```bash
# 确保先运行初始化
ts-node scripts/initialize-testnet.ts

# 验证初始化状态
ts-node scripts/verify-deployment.ts
```

### 5.3 Guardian配置

**Q: 测试网需要真实Guardian吗？**

**开发测试阶段**: 
- 使用测试Guardian密钥（19个确定性密钥）
- 代码位置: `tests/utils/vaa.ts` 中的 `TEST_GUARDIAN_KEYS`
- 可直接用于测试

**集成测试阶段**:
- 需要部署真实Guardian节点（至少13个）
- 或者使用mock Guardian服务

**测试Guardian示例**:

```typescript
// tests/utils/setup.ts
export const TEST_GUARDIAN_KEYS = generateGuardianKeys(19);

// 获取Guardian地址用于初始化
export function getGuardianAddresses(): Array<[number; 20]> {
  return TEST_GUARDIAN_KEYS.map(key => 
    Array.from(key.address) as any
  );
}
```

### 5.4 性能优化

**Q: 测试运行太慢**

```bash
# 1. 并行运行测试（注意状态隔离）
yarn test:unit & yarn test:integration

# 2. 跳过E2E测试（开发阶段）
yarn test:unit

# 3. 使用本地RPC节点（更快）
# 部署本地solana-test-validator并配置自定义程序
```

**Q: 如何加速交易确认？**

在测试代码中使用更高的commitment level：

```typescript
const connection = new Connection(rpcUrl, {
  commitment: "processed",  // 最快但不最终
  // commitment: "confirmed", // 平衡
  // commitment: "finalized", // 最慢但最终
});
```

---

## 附录

### A. 完整部署检查清单

- [ ] Solana CLI已安装并配置
- [ ] Anchor CLI已安装
- [ ] 钱包已创建并有足够余额(≥5 SOL)
- [ ] RPC URL可访问
- [ ] Anchor.toml配置正确
- [ ] Program ID已更新(如需要)
- [ ] 编译成功(`anchor build`)
- [ ] 部署成功(`anchor deploy`)
- [ ] Bridge已初始化
- [ ] BridgeConfig已初始化
- [ ] 验证脚本通过

### B. 环境变量清单

```bash
# RPC配置
export ANCHOR_PROVIDER_URL="https://your-custom-rpc.com"
export ANCHOR_WALLET="~/.config/solana/testnet-keypair.json"

# 程序ID（如果与默认不同）
export CORE_PROGRAM_ID="deployed_core_program_id"
export TOKEN_PROGRAM_ID="deployed_token_program_id"

# 测试配置
export USE_TESTNET=true
export TEST_TIMEOUT=300000  # 5分钟
```

### C. 快速命令参考

```bash
# === 配置 ===
solana config set --url <RPC_URL>
solana config get

# === 部署 ===
anchor build
anchor deploy
anchor deploy --program-name solana_core
anchor deploy --program-name token_bridge

# === 测试 ===
anchor test --skip-local-validator
yarn test:unit
yarn test:integration

# === 验证 ===
solana program show <PROGRAM_ID>
solana account <PDA_ADDRESS>

# === 升级 ===
anchor upgrade <SO_FILE> --program-id <PROGRAM_ID>
```

### D. 推荐的测试网RPC

| 网络 | RPC URL | 说明 |
|------|---------|------|
| **Devnet** | https://api.devnet.solana.com | 官方测试网 |
| **Testnet** | https://api.testnet.solana.com | 官方测试网 |
| **自定义** | 您的RPC URL | 自建测试网 |

---

**文档状态**: ✅ v1.0  
**维护者**: Solana合约开发团队  
**相关文档**: [README.md](../README.md) | [PROGRESS.md](./docs/PROGRESS.md)


