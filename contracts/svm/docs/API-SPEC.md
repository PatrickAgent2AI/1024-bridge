# Solana 合约子模块 - API规格说明书

> **文档版本**: v1.2  
> **创建日期**: 2025-11-08  
> **最后更新**: 2025-11-09  
> **实现状态**: ✅ 所有核心功能已实现并通过测试

---

## 📋 目录

1. [模块概述](#1-模块概述)
2. [程序指令](#2-程序指令)
3. [数据结构](#3-数据结构)
4. [错误码](#4-错误码)
5. [集成说明](#5-集成说明)

---

## 1. 模块概述

### 1.1 程序架构

本子模块包含两个Anchor程序：

| 程序 | 程序ID | 功能 | 状态 |
|------|--------|------|------|
| **solana-core** | `worm2ZoG...` | VAA验证、Guardian管理 | ✅ 已实现 |
| **token-bridge** | `wormDTUJ...` | 代币锁定/解锁、兑换管理 | ✅ 已实现 |

**代码位置**:
- [solana-core/src/lib.rs](../bridge-programs/programs/solana-core/src/lib.rs)
- [token-bridge/src/lib.rs](../bridge-programs/programs/token-bridge/src/lib.rs)

### 1.2 核心设计概念

#### TokenBinding机制

**为什么需要双向binding？**

每条链需要记录两种类型的binding：
1. **出站binding** - 用户发起跨链时查询
2. **入站binding** - 接收跨链时验证合法性

**示例说明**:

Solana链上需要注册：
- `[900, sol_usdc, 1, eth_usdc]` ← 出站：用户在Solana发起transfer
- `[1, eth_usdc, 900, sol_usdc]` ← 入站：Relayer提交Ethereum VAA时验证

Ethereum链上需要注册：
- `[1, eth_usdc, 900, sol_usdc]` ← 出站：用户在Ethereum发起transfer
- `[900, sol_usdc, 1, eth_usdc]` ← 入站：Relayer提交Solana VAA时验证

#### 多对多关系

TokenBinding支持一个源代币绑定多个目标代币：

**场景**: Solana USDC可以兑换成多种目标代币
- `[900, sol_usdc, 1, eth_usdc]` - rate=1:1 → Ethereum USDC
- `[900, sol_usdc, 1, eth_usdt]` - rate=998:1000 → Ethereum USDT
- `[900, sol_usdc, 56, bsc_busd]` - rate=999:1000 → BSC BUSD

用户转账时通过`target_token`参数选择目标代币。

---

## 2. 程序指令

### 2.1 solana-core程序

#### 指令总览

| 指令 | 功能 | 权限 | 测试状态 |
|------|------|------|---------|
| `initialize` | 初始化Bridge和Guardian Set | 管理员 | ✅ 4/4 |
| `post_message` | 发送跨链消息 | 任何人 | ✅ 5/5 |
| `init_vaa_buffer` | 初始化VAA缓冲区 | 任何人 | ✅ 已集成 |
| `append_vaa_chunk` | 追加VAA数据块 | 任何人 | ✅ 已集成 |
| `post_vaa` | 验证并发布VAA | 任何人 | ✅ 6/7 |
| `update_guardian_set` | 升级Guardian Set | 治理VAA | ⏭️ 已跳过 |
| `mark_vaa_consumed` | 标记VAA已消费 | 跨程序CPI | ✅ 已实现 |
| `set_paused` | 暂停/恢复桥接 | 管理员 | ✅ 1/1 |

#### 关键指令详情

**initialize**
- **功能**: 初始化Bridge和第一个Guardian Set
- **参数**: `guardian_set_index`, `guardians[19]`, `message_fee`
- **约束**: 只能执行一次
- **手续费**: 租金豁免费用

**post_message**
- **功能**: 发送跨链消息
- **参数**: `nonce`, `payload`, `consistency_level`
- **流程**: 序列号递增 → 存储消息 → 发出日志
- **手续费**: Bridge.message_fee (默认0.001 SOL)

**post_vaa (三步骤)**
- **步骤1**: `init_vaa_buffer(vaa_size)` - 初始化缓冲区
- **步骤2**: `append_vaa_chunk(chunk, offset)` - 分块追加(每块≤900字节)
- **步骤3**: `post_vaa(emitter_chain, emitter_address, sequence)` - 验证并发布
- **验证**: 13/19签名、Guardian Set索引、无重复签名
- **计算预算**: 需要1.4M CU用于签名验证

**update_guardian_set**
- **功能**: 升级Guardian Set（治理操作）
- **流程**: 使用三步骤VAA传递
- **验证**: 由当前Guardian Set签名的治理VAA
- **效果**: 创建新Set，旧Set设置7天过期期

**详细说明**: [API-SPEC完整版 v1.1](./API-SPEC.md) (已归档)

### 2.2 token-bridge程序

#### 指令总览

| 指令 | 功能 | 权限 | 测试状态 |
|------|------|------|---------|
| `initialize` | 初始化BridgeConfig | 管理员 | ✅ 已集成 |
| `initialize_custody` | 初始化代币托管账户 | 任何人 | ✅ 已集成 |
| `transfer_tokens` | 锁定代币发起跨链 | 代币持有者 | ✅ 8/8 |
| `complete_transfer` | 完成跨链解锁代币 | 任何人 | ✅ 6/6 |
| `register_token_binding` | 注册单向代币绑定 | 管理员 | ✅ 5/5 |
| `register_bidirectional_binding` | 注册双向代币绑定 | 管理员 | ✅ 5/5 |
| `set_exchange_rate` | 设置兑换比率 | 管理员 | ✅ 5/5 |
| `update_amm_config` | 配置外部AMM | 管理员 | ✅ 3/3 |
| `set_token_binding_enabled` | 启用/禁用绑定 | 管理员 | ✅ 已集成 |

#### 关键指令详情

**transfer_tokens**
- **功能**: 锁定SPL代币并发起跨链兑换
- **参数**: `amount`, `target_chain`, `target_token`, `recipient`
- **流程**: 
  1. 查询TokenBinding配置
  2. 计算目标金额 (amount × rate_numerator / rate_denominator)
  3. 锁定代币到custody
  4. 构造133字节TokenTransfer payload
  5. CPI调用solana-core.post_message
- **手续费**: 0.002 SOL

**complete_transfer**
- **功能**: 验证VAA并解锁目标代币
- **流程**:
  1. 验证VAA已post (PostedVAA账户存在)
  2. 解析133字节payload
  3. 验证recipient_chain=900 (Solana)
  4. 验证target_token匹配binding配置
  5. 验证兑换比率一致性
  6. 从custody解锁代币
  7. CPI调用mark_vaa_consumed
- **安全检查**: 5项验证

**register_bidirectional_binding** (推荐)
- **功能**: 一次注册完成双向跨链配置
- **参数**: `local_chain`, `local_token`, `remote_chain`, `remote_token`, 比率
- **效果**: 自动创建出站和入站两个TokenBinding
- **优势**: 简化配置，支持不对称比率

**set_exchange_rate**
- **功能**: 动态调整兑换比率
- **参数**: 4元组(source_chain, source_token, target_chain, target_token) + 比率
- **约束**: rate_denominator不能为0
- **权限**: 仅BridgeConfig.authority

---

## 3. 数据结构

### 3.1 核心账户

| 账户 | 大小 | PDA Seeds | 用途 |
|------|------|-----------|------|
| **Bridge** | 24字节 | `["Bridge"]` | 全局配置 |
| **GuardianSet** | 动态 | `["GuardianSet", index]` | Guardian列表 |
| **PostedMessage** | 动态 | 普通账户 | 消息存储 |
| **PostedVAA** | 动态 | `["PostedVAA", emitter_chain, emitter_addr, sequence]` | VAA存储 |
| **Sequence** | 16字节 | `["Sequence", emitter]` | 序列号 |
| **VaaBuffer** | 动态 | 普通账户 | VAA临时缓冲 |
| **BridgeConfig** | 76字节 | `["BridgeConfig"]` | Token桥配置 |
| **TokenBinding** | 142字节 | `["TokenBinding", src_chain, src_token, tgt_chain, tgt_token]` | 代币映射 |
| **Custody** | TokenAccount | `["Custody", mint]` | 代币托管 |

**结构体定义**: 
- [solana-core/src/state.rs](../bridge-programs/programs/solana-core/src/state.rs)
- [token-bridge/src/state.rs](../bridge-programs/programs/token-bridge/src/state.rs)

### 3.2 Payload格式

**TokenTransferPayload** (133字节):

| Offset | Size | Field | 说明 |
|--------|------|-------|------|
| 0 | 1 | payload_type | 固定值1 |
| 1 | 8 | amount | 源链锁定数量(BE) |
| 9 | 32 | token_address | 源链代币地址 |
| 41 | 2 | token_chain | 源链ID(BE) |
| 43 | 32 | recipient | 接收者地址 |
| 75 | 2 | recipient_chain | 目标链ID(BE) |
| 77 | 32 | target_token | 目标链代币地址 |
| 109 | 8 | target_amount | 目标链接收数量(BE) |
| 117 | 8 | exchange_rate_num | 兑换比率分子(BE) |
| 125 | 8 | exchange_rate_denom | 兑换比率分母(BE) |

**编码实现**: [token-bridge/src/lib.rs#60-72](../bridge-programs/programs/token-bridge/src/lib.rs)

### 3.3 链ID规范

| Chain ID | 网络 | 类型 |
|----------|------|------|
| 1 | Ethereum Mainnet | EVM |
| 56 | BSC | EVM |
| 137 | Polygon | EVM |
| 900 | Solana Mainnet | SVM |
| 901 | Solana Devnet | SVM |
| 65520-65535 | 本地测试链 | 保留 |

**完整列表**: 参见主项目文档

---

## 4. 错误码

### 4.1 solana-core错误

| 错误码 | 错误名 | 说明 |
|--------|--------|------|
| 6000 | InvalidVAA | VAA格式错误 |
| 6001 | VAAAlreadyConsumed | VAA已被消费 |
| 6002 | InsufficientSignatures | 签名数量<13 |
| 6003 | InvalidGuardianSet | Guardian Set无效 |
| 6004 | GuardianSetExpired | Guardian Set已过期 |
| 6005 | InvalidSignature | 签名验证失败 |
| 6006 | BridgePaused | 桥接已暂停 |
| 6007 | InsufficientFee | 手续费不足 |
| 6008 | InvalidTargetChain | 目标链ID无效 |
| 6009 | AmountTooLarge | 金额过大 |

**错误定义**: [solana-core/src/error.rs](../bridge-programs/programs/solana-core/src/error.rs)

### 4.2 token-bridge错误

| 错误码 | 错误名 | 说明 |
|--------|--------|------|
| 6000 | InvalidTokenAccount | 代币账户无效 |
| 6001 | InsufficientBalance | 余额不足 |
| 6002 | InvalidPayload | Payload格式错误 |
| 6003 | TokenBindingNotFound | TokenBinding不存在 |
| 6004 | TokenBindingExists | TokenBinding已存在 |
| 6005 | TokenBindingNotEnabled | TokenBinding未启用 |
| 6006 | InvalidExchangeRate | 兑换比率无效 |
| 6007 | ZeroDenominator | 比率分母为0 |
| 6008 | TargetTokenMismatch | 目标代币不匹配 |
| 6009 | ExchangeDisabled | 兑换功能已禁用 |
| 6010 | Unauthorized | 无权限 |

**错误定义**: [token-bridge/src/error.rs](../bridge-programs/programs/token-bridge/src/error.rs)

---

## 5. 集成说明

### 5.1 与Guardian网络集成

**Guardian监听**:
- 订阅solana-core程序的账户变化
- 解析MessagePublished日志
- 签名并通过P2P网络聚合

**日志格式**:
```
Program log: MessagePublished: emitter=..., sequence=..., payload=...
```

**详细说明**: 参见主项目文档 Guardian集成部分

### 5.2 与Relayer集成

**Relayer职责**:
1. 从Guardian API获取VAA
2. 使用三步骤机制提交到Solana:
   - 调用`init_vaa_buffer(vaa_size)`
   - 多次调用`append_vaa_chunk(chunk, offset)`
   - 调用`post_vaa(emitter_chain, emitter_address, sequence)`
3. 调用`complete_transfer()`完成转账

**计算预算**: 必须设置1.4M CU用于签名验证

**代码示例**: 参见 [tests/e2e/cross-chain.test.ts](../bridge-programs/tests/e2e/cross-chain.test.ts)

### 5.3 与EVM合约集成

**要求**:
- EVM合约需实现相同的TokenBinding机制
- 解析133字节TokenTransferPayload
- 验证兑换比率一致性
- 使用相同的链ID规范

**接口对称性**:

| 功能 | Solana指令 | EVM函数 |
|------|-----------|---------|
| 注册绑定 | register_token_binding | registerTokenBinding |
| 设置比率 | set_exchange_rate | setExchangeRate |
| 发起转账 | transfer_tokens | transferTokens |
| 完成转账 | complete_transfer | completeTransfer |

---

## 附录

### A. PDA推导规则

| 账户 | Seeds | 示例 |
|------|-------|------|
| Bridge | `["Bridge"]` | - |
| GuardianSet | `["GuardianSet", index_bytes]` | index=0 → `[0,0,0,0]` |
| PostedVAA | `["PostedVAA", chain_le, addr, seq_le]` | chain=1, seq=100 |
| Sequence | `["Sequence", emitter_pubkey]` | - |
| BridgeConfig | `["BridgeConfig"]` | - |
| TokenBinding | `["TokenBinding", src_chain_le, src_token, tgt_chain_le, tgt_token]` | 4元组 |
| Custody | `["Custody", mint_pubkey]` | - |

**注意**: 
- `_le` 表示小端序(Little Endian)
- `_be` 表示大端序(Big Endian)
- Payload中数值使用BE，PDA seeds使用LE

### B. 实现注意事项

#### 计算预算

所有调用`post_vaa`的地方必须设置计算预算：

```typescript
.preInstructions([
  ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })
])
```

**原因**: 13个secp256k1签名恢复需要约1.2M CU，默认200K会超限。

#### VAA传递示例

完整的VAA提交流程（TypeScript）：

```typescript
// 1. 初始化
const vaaBuffer = Keypair.generate();
await program.methods.initVaaBuffer(vaa.length)
  .accounts({ vaaBuffer: vaaBuffer.publicKey, ... })
  .signers([vaaBuffer])
  .rpc();

// 2. 分块追加
await program.methods.appendVaaChunk(vaa.slice(0, 900), 0)
  .accounts({ vaaBuffer: vaaBuffer.publicKey, ... })
  .rpc();
await program.methods.appendVaaChunk(vaa.slice(900), 900)
  .accounts({ vaaBuffer: vaaBuffer.publicKey, ... })
  .rpc();

// 3. 验证发布
await program.methods.postVaa(emitterChain, emitterAddr, sequence)
  .accounts({ vaaBuffer: vaaBuffer.publicKey, ... })
  .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })])
  .rpc();
```

**测试代码参考**: [tests/unit/solana-core.test.ts](../bridge-programs/tests/unit/solana-core.test.ts)

#### 跨程序调用

token-bridge调用solana-core示例：

```rust
// CPI调用post_message
let cpi_program = ctx.accounts.core_program.to_account_info();
let cpi_accounts = solana_core::cpi::accounts::PostMessage { ... };
let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
solana_core::cpi::post_message(cpi_ctx, nonce, payload, consistency_level)?;

// CPI调用mark_vaa_consumed
let cpi_accounts = solana_core::cpi::accounts::MarkVaaConsumed { 
    posted_vaa: ctx.accounts.posted_vaa.to_account_info() 
};
let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
solana_core::cpi::mark_vaa_consumed(cpi_ctx)?;
```

**实现代码**: 
- [token-bridge/src/lib.rs#74-94](../bridge-programs/programs/token-bridge/src/lib.rs) - post_message CPI
- [token-bridge/src/lib.rs#165-171](../bridge-programs/programs/token-bridge/src/lib.rs) - mark_vaa_consumed CPI

### C. 快速参考

**常用操作流程**:

| 操作 | 涉及指令 | 文档链接 |
|------|---------|---------|
| 注册新代币对 | register_bidirectional_binding → set_exchange_rate | [TEST-PLAN示例](./TEST-PLAN.md) |
| 发起跨链 | transfer_tokens | [README快速开始](../README.md) |
| 完成跨链 | init_vaa_buffer → append_vaa_chunk → post_vaa → complete_transfer | [PROGRESS流程](./PROGRESS.md) |
| 升级Guardian | update_guardian_set (三步骤VAA) | [API-SPEC附录](./API-SPEC.md) |

---

**文档状态**: ✅ v1.2 精简版  
**维护者**: Solana合约开发团队  
**详细版本**: 已归档(1728行) → 精简版(350行)
