# Solana 合约子模块 - API规格说明书

> **文档版本**: v1.1  
> **创建日期**: 2025-11-08  
> **最后更新**: 2025-11-09  
> **子模块范围**: Solana程序接口规范  
> **实现状态**: 核心功能已实现并通过测试，签名验证已完成

---

## 📋 目录

1. [模块概述](#1-模块概述)
2. [Solana程序接口](#2-solana程序接口)
3. [数据结构定义](#3-数据结构定义)
4. [错误码规范](#4-错误码规范)
5. [与其他模块的集成](#5-与其他模块的集成)

---

## 1. 模块概述

### 1.1 Solana程序架构

本子模块包含两个核心Anchor程序：

```
contracts/svm/
├── solana-core           # 核心桥接程序
│   ├── post_message      # 发送跨链消息
│   ├── post_vaa          # 接收并验证VAA
│   └── Guardian管理      # Guardian Set升级
│
└── token-bridge          # 代币桥程序
    ├── register_token_binding  # 注册代币映射关系
    ├── set_exchange_rate       # 设置跨链兑换比率
    ├── transfer_tokens         # 锁定SPL代币发起跨链兑换
    ├── complete_transfer       # 完成跨链兑换转账
    └── update_amm_config       # 更新AMM配置（预留）
```

### 1.2 支持的功能

| 功能 | 程序 | 说明 |
|------|------|------|
| 发送跨链消息 | solana-core | 锁定SPL代币后发送消息 |
| 接收VAA | solana-core | 验证Guardian签名 |
| Guardian升级 | solana-core | 同步更新Guardian Set |
| SPL代币跨链 | token-bridge | 锁定/解锁SPL代币 |
| 代币注册绑定 | token-bridge | 单向/双向注册代币映射（支持多对多） |
| 跨链兑换 | token-bridge | 支持不同代币间的跨链兑换 |
| 兑换比率管理 | token-bridge | 管理员配置兑换比率，支持双向不对称 |
| AMM动态定价 | token-bridge | 预留外部AMM接口（未来支持） |

---

### 1.3 核心设计概念

#### 双向Binding机制

**为什么需要双向binding？**

每条链需要记录两种类型的binding：
1. **出站binding** (source_chain = 本链)：用户发起跨链时查询
2. **入站binding** (source_chain = 对方链)：接收跨链时验证合法性

**示例**：
```
Solana链上需要注册：
  [900, sol_usdc, 1, eth_usdc] ← 出站：用户在Solana发起transfer_tokens
  [1, eth_usdc, 900, sol_usdc] ← 入站：Relayer提交Ethereum的VAA时验证

Ethereum链上需要注册：
  [1, eth_usdc, 900, sol_usdc] ← 出站：用户在Ethereum发起transferTokens
  [900, sol_usdc, 1, eth_usdc] ← 入站：Relayer提交Solana的VAA时验证
```

**完整流程**：
```
1. Solana用户调用transfer_tokens(target_token=eth_usdc)
   → 查询[900, sol_usdc, 1, eth_usdc]出站binding ✅
   → 锁定sol_usdc，发送VAA

2. Guardian签名VAA

3. Relayer在Ethereum调用completeTransfer(vaa)
   → 查询[900, sol_usdc, 1, eth_usdc]入站binding ✅
   → 验证通过，解锁eth_usdc
```

#### 多对多关系

**TokenBinding的PDA包含4个元素**：
```
[source_chain, source_token, target_chain, target_token]
```

**支持一个源代币绑定多个目标代币**：
```
Solana USDC可以兑换成：
  [900, sol_usdc, 1, eth_usdc]    rate=1:1        ← Ethereum USDC
  [900, sol_usdc, 1, eth_usdt]    rate=998:1000   ← Ethereum USDT
  [900, sol_usdc, 1, eth_dai]     rate=1001:1000  ← Ethereum DAI
  [900, sol_usdc, 56, bsc_busd]   rate=999:1000   ← BSC BUSD
  [900, sol_usdc, 137, poly_usdc] rate=1:1        ← Polygon USDC

用户转账时指定target_token选择目标代币
```

---

## 2. Solana程序接口

### 2.1 solana-core - 核心程序

#### 2.1.1 post_message

**功能**: 发送跨链消息到EVM链

**接口**:
```rust
pub fn post_message(
    ctx: Context<PostMessage>,
    nonce: u32,
    payload: Vec<u8>,
    consistency_level: u8,
) -> Result<()>
```

**参数**:
- `nonce`: 随机数（防重放，用户自定义）
- `payload`: 消息载荷（包含代币转账信息）
- `consistency_level`: 确认级别
  - `1` = 即时确认（1个slot）
  - `15` = 安全确认（15个slot，约6秒）
  - `32` = 最终确认（32个slot，约12秒）

**账户结构**:
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

**事件日志**:
```rust
msg!(
    "MessagePublished: emitter={}, sequence={}, nonce={}, consistency_level={}, payload={}",
    emitter, sequence, nonce, consistency_level, hex::encode(&payload)
);
```

**手续费**: 固定0.001 SOL

---

#### 2.1.1.1 init_vaa_buffer

**功能**: 初始化VAA数据缓冲区（用于接收大型VAA）

**接口**:
```rust
pub fn init_vaa_buffer(
    ctx: Context<InitVaaBuffer>,
    vaa_size: u32,
) -> Result<()>
```

**参数**:
- `vaa_size`: VAA总大小（字节）

**用途**: 为大型VAA分配存储空间

---

#### 2.1.1.2 append_vaa_chunk

**功能**: 追加VAA数据块

**接口**:
```rust
pub fn append_vaa_chunk(
    ctx: Context<AppendVaaChunk>,
    chunk: Vec<u8>,
    offset: u32,
) -> Result<()>
```

**参数**:
- `chunk`: VAA数据块（建议≤900字节）
- `offset`: 写入偏移量

**限制**: 每个chunk建议≤900字节，确保交易不超过1232字节限制

---

#### 2.1.2 post_vaa (多步骤VAA传递)

**功能**: 接收并验证来自EVM链的VAA（支持大VAA传递）

**设计背景**:
由于Anchor框架对`Vec<u8>`参数的序列化限制（约1KB），大型VAA（如包含13个签名的VAA约1072字节）无法直接作为参数传递。采用**三步骤机制**解决：

**步骤1: 初始化VAA缓冲区**
```rust
pub fn init_vaa_buffer(
    ctx: Context<InitVaaBuffer>,
    vaa_size: u32,
) -> Result<()>
```

**步骤2: 追加VAA数据块**
```rust
pub fn append_vaa_chunk(
    ctx: Context<AppendVaaChunk>,
    chunk: Vec<u8>,
    offset: u32,
) -> Result<()>
```

**步骤3: 验证并发布VAA**
```rust
pub fn post_vaa(
    ctx: Context<PostVAA>,
) -> Result<()>
```

**完整流程**:
```rust
// 1. 初始化VAA缓冲区（假设VAA大小1072字节）
init_vaa_buffer(vaa_size: 1072)

// 2. 分块追加数据（每块最多900字节）
append_vaa_chunk(chunk: vaa[0..900], offset: 0)
append_vaa_chunk(chunk: vaa[900..1072], offset: 900)

// 3. 验证并发布VAA
post_vaa()  // 从VaaBuffer账户读取完整VAA并验证
```

**验证步骤**（在post_vaa中）:
1. 从VaaBuffer账户读取完整VAA
2. 解析VAA结构（header + signatures + body）
3. **验证Guardian签名**（✅ 已实现）:
   ```rust
   // 双重哈希
   let body_hash = keccak256(body);
   let double_hash = keccak256(body_hash);
   
   // 恢复公钥并验证每个签名
   for sig in signatures {
       let recovered_pubkey = secp256k1_recover(double_hash, sig);
       let recovered_address = keccak256(pubkey)[12..32];
       require!(recovered_address == guardian_set.guardians[sig.index]);
   }
   ```
4. 检查签名数量 ≥ 门限（13/19）
5. 检查Guardian Set索引有效
6. 检查签名索引去重（防止重复签名）
7. 存储到PostedVAA账户（consumed=false）

**计算资源**:
- 需要约1.4M计算单元（CU）用于13个签名验证
- 测试中需添加：`ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })`

**账户结构**:
```rust
#[derive(Accounts)]
pub struct PostVAA<'info> {
    #[account(mut)]
    pub bridge: Account<'info, Bridge>,
    
    pub guardian_set: Account<'info, GuardianSet>,
    
    #[account(init, payer = payer, space = 8 + 2048)]
    pub posted_vaa: Account<'info, PostedVAA>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}
```

**错误处理**:
```rust
if signatures.len() < guardian_set.threshold {
    return Err(BridgeError::InsufficientSignatures.into());
}

if ctx.accounts.posted_vaa.consumed {
    return Err(BridgeError::VAAAlreadyConsumed.into());
}
```

---

#### 2.1.3 update_guardian_set (多步骤VAA传递)

**功能**: 升级Guardian Set（管理员接口）

**接口**:
```rust
pub fn update_guardian_set(
    ctx: Context<UpdateGuardianSet>,
) -> Result<()>
```

**说明**: 
- GuardianSet升级VAA通常较大（约1301字节，包含19个Guardian地址）
- 使用与post_vaa相同的三步骤机制：
  1. `init_vaa_buffer(1301)` - 初始化缓冲区
  2. `append_vaa_chunk(chunk1, 0)` + `append_vaa_chunk(chunk2, 900)` - 分块追加
  3. `update_guardian_set()` - 从VaaBuffer读取并验证

**权限**: 只能通过治理VAA调用

**VAA Payload格式**:
```rust
struct GuardianSetUpgrade {
    module: u8,           // 0x01 (Core)
    action: u8,           // 0x02 (GuardianSetUpgrade)
    chain: u16,           // 0 (all chains) or 2 (Solana)
    new_index: u32,
    new_guardians: Vec<[u8; 20]>,  // Ethereum地址格式
}
```

**升级流程**:
1. 验证VAA（由当前Guardian Set签名）
2. 解析payload获取新Guardian Set
3. 创建新GuardianSet账户（索引+1）
4. 设置旧Set过期时间（7天后）
5. 发出GuardianSetChanged事件

---

#### 2.1.4 查询函数

**get_guardian_set**:
```rust
pub fn get_current_guardian_set(
    ctx: Context<QueryGuardianSet>,
) -> Result<GuardianSetData>
```

**is_vaa_consumed**:
```rust
pub fn is_vaa_consumed(
    ctx: Context<QueryVAA>,
    vaa_hash: [u8; 32],
) -> Result<bool>
```

---

### 2.2 token-bridge - 代币桥程序

#### 2.2.1 transfer_tokens

**功能**: 锁定SPL代币并发起跨链兑换转账到目标链

**接口**:
```rust
pub fn transfer_tokens(
    ctx: Context<TransferTokens>,
    amount: u64,
    target_chain: u16,
    target_token: [u8; 32],
    recipient: [u8; 32],
) -> Result<()>
```

**参数**:
- `amount`: 转账数量（源链代币数量）
- `target_chain`: 目标链ID（1=Ethereum, 56=BSC, 137=Polygon, 900=Solana等）
- `target_token`: 目标链代币地址（32字节格式，用户选择要兑换成哪种代币）
- `recipient`: 接收者地址（32字节格式）

**账户结构**:
```rust
#[derive(Accounts)]
#[instruction(amount: u64, target_chain: u16, target_token: [u8; 32])]
pub struct TransferTokens<'info> {
    #[account(mut)]
    pub bridge: Account<'info, Bridge>,
    
    #[account(
        seeds = [
            b"TokenBinding",
            900u16.to_le_bytes().as_ref(),    // source_chain (Solana=900)
            token_mint.key().as_ref(),        // source_token
            target_chain.to_le_bytes().as_ref(),  // target_chain
            target_token.as_ref(),            // target_token (新增)
        ],
        bump
    )]
    pub token_binding: Account<'info, TokenBinding>,
    
    #[account(mut)]
    pub token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub custody_account: Account<'info, TokenAccount>,
    
    pub token_authority: Signer<'info>,
    
    pub token_mint: Account<'info, Mint>,
    
    pub token_program: Program<'info, Token>,
}
```

**流程**:
1. 检查TokenBinding是否存在且已启用
2. 转账SPL代币到custody账户（锁定）
3. 计算目标链代币数量（应用兑换比率）:
   ```rust
   let target_amount = if token_binding.use_external_price {
       // 调用外部AMM获取价格（预留）
       fetch_amm_price(token_binding.amm_program_id, amount)?
   } else {
       // 使用固定比率
       amount * token_binding.rate_numerator / token_binding.rate_denominator
   };
   ```
4. 构造TokenTransfer payload（包含目标代币信息）
5. 调用solana-core的post_message
6. 返回序列号

**Payload扩展**:
```rust
pub struct TokenTransferPayload {
    pub payload_type: u8,          // 1 = token transfer
    pub amount: u64,               // 源链锁定数量
    pub token_address: [u8; 32],   // 源链代币地址
    pub token_chain: u16,          // 源链ID
    pub recipient: [u8; 32],       // 接收者地址
    pub recipient_chain: u16,      // 目标链ID
    
    // 新增字段
    pub target_token: [u8; 32],    // 目标链代币地址
    pub target_amount: u64,        // 目标链接收数量
    pub exchange_rate_num: u64,    // 兑换比率分子
    pub exchange_rate_denom: u64,  // 兑换比率分母
}
```

**手续费**: 0.002 SOL（包含post_message费用）

**使用示例**:
```rust
// 示例1: USDC → USDC (1:1同币种兑换)
transfer_tokens(
    amount: 1000_000_000,  // 1000 USDC
    target_chain: 1,        // Ethereum
    target_token: eth_usdc_address,  // 用户选择兑换成USDC
    recipient: eth_address
)
// → 目标链接收: 1000 USDC

// 示例2: USDC → USDT (不同币种兑换)
transfer_tokens(
    amount: 1000_000_000,  // 1000 USDC
    target_chain: 1,        // Ethereum
    target_token: eth_usdt_address,  // 用户选择兑换成USDT
    recipient: eth_address
)
// → 目标链接收: 998 USDT (假设比率为998:1000)

// 示例3: USDC → DAI (另一种稳定币)
transfer_tokens(
    amount: 1000_000_000,  // 1000 USDC
    target_chain: 1,        // Ethereum
    target_token: eth_dai_address,   // 用户选择兑换成DAI
    recipient: eth_address
)
// → 目标链接收: 1001 DAI (假设比率为1001:1000)
```

**多对多关系支持**:
同一个源代币可以绑定到多个目标代币，用户在转账时自由选择：
```
Solana USDC (900) →  Ethereum USDC (1)    rate 1:1
                   →  Ethereum USDT (1)    rate 1:0.998
                   →  Ethereum DAI (1)     rate 1:1.001
                   →  BSC BUSD (56)        rate 1:0.999
                   →  Polygon USDC (137)   rate 1:1
```

---

#### 2.2.2 complete_transfer

**功能**: 完成跨链兑换转账（解锁目标链代币）

**接口**:
```rust
pub fn complete_transfer(
    ctx: Context<CompleteTransfer>,
    vaa: Vec<u8>,
) -> Result<()>
```

**流程**:
1. 验证VAA（调用post_vaa）
2. 解析TokenTransfer payload（包含兑换信息）
3. 检查目标链 = Solana（chain_id=2）
4. 验证TokenBinding配置:
   ```rust
   // 反向查找TokenBinding（源链→Solana）
   let binding = load_token_binding(
       payload.token_chain,
       payload.token_address,
       2  // Solana
   )?;
   
   // 验证目标代币匹配
   require!(
       binding.target_token == payload.target_token,
       TokenBridgeError::TargetTokenMismatch
   );
   ```
5. 验证兑换比率一致性（防止篡改）:
   ```rust
   let expected_target_amount = payload.amount
       .checked_mul(binding.rate_numerator).unwrap()
       .checked_div(binding.rate_denominator).unwrap();
   
   require!(
       payload.target_amount == expected_target_amount,
       TokenBridgeError::InvalidExchangeRate
   );
   ```
6. 从custody解锁目标代币到接收者
7. 标记VAA已消费

**账户结构**:
```rust
#[derive(Accounts)]
pub struct CompleteTransfer<'info> {
    #[account(mut)]
    pub bridge: Account<'info, Bridge>,
    
    #[account(mut)]
    pub posted_vaa: Account<'info, PostedVAA>,
    
    #[account(
        seeds = [
            b"TokenBinding",
            // 从VAA payload中提取：
            payload.token_chain.to_le_bytes().as_ref(),     // source_chain
            payload.token_address.as_ref(),                 // source_token
            payload.recipient_chain.to_le_bytes().as_ref(), // target_chain (本链)
            payload.target_token.as_ref(),                  // target_token
        ],
        bump
    )]
    pub token_binding: Account<'info, TokenBinding>,
    
    #[account(mut)]
    pub recipient_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub custody_account: Account<'info, TokenAccount>,
    
    pub target_token_mint: Account<'info, Mint>,
    
    pub token_program: Program<'info, Token>,
}
```

**关键**：complete_transfer查询的是**入站binding**（source_chain=对方链）

**安全检查**:
```rust
// 1. 验证目标代币Mint匹配
require!(
    recipient_account.mint == target_token_mint.key(),
    TokenBridgeError::InvalidTokenAccount
);

// 2. 验证custody有足够余额
require!(
    custody_account.amount >= payload.target_amount,
    TokenBridgeError::InsufficientBalance
);

// 3. 验证TokenBinding启用
require!(
    token_binding.enabled,
    TokenBridgeError::TokenBindingNotEnabled
);
```

**使用示例**:
```rust
// 场景: Ethereum USDT → Solana USDC
// VAA payload包含:
// - source: Ethereum USDT, amount=1000
// - target: Solana USDC, target_amount=1002
// - exchange_rate: 1000/998 (USDT稍便宜)

complete_transfer(vaa)
// → custody解锁1002 USDC到接收者
```

---

#### 2.2.3 register_token_binding

**功能**: 注册**单向**代币映射关系（管理员接口）

> **重要**：这是单向注册。双向跨链需要在两条链上各注册一次，或使用`register_bidirectional_binding`

**接口**:
```rust
pub fn register_token_binding(
    ctx: Context<RegisterTokenBinding>,
    source_chain: u16,
    source_token: [u8; 32],
    target_chain: u16,
    target_token: [u8; 32],
) -> Result<()>
```

**参数**:
- `source_chain`: 源链ID（如1=Ethereum, 56=BSC, 900=Solana）
- `source_token`: 源链代币地址（32字节格式）
- `target_chain`: 目标链ID（如1=Ethereum, 56=BSC, 900=Solana）
- `target_token`: 目标链代币地址（32字节格式）

**权限**: 仅管理员可调用

**账户结构**:
```rust
#[derive(Accounts)]
#[instruction(source_chain: u16, source_token: [u8; 32], target_chain: u16, target_token: [u8; 32])]
pub struct RegisterTokenBinding<'info> {
    #[account(mut)]
    pub bridge_config: Account<'info, BridgeConfig>,
    
    #[account(
        init,
        payer = payer,
        space = TokenBinding::LEN,
        seeds = [
            b"TokenBinding",
            source_chain.to_le_bytes().as_ref(),
            source_token.as_ref(),
            target_chain.to_le_bytes().as_ref(),
            target_token.as_ref(),  // 新增：支持多对多
        ],
        bump
    )]
    pub token_binding: Account<'info, TokenBinding>,
    
    pub authority: Signer<'info>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}
```

**单向注册示例**:
```rust
// 在Solana链上注册：Solana USDC → Ethereum USDC (出站)
register_token_binding(
    source_chain: 900,  // Solana
    source_token: sol_usdc,
    target_chain: 1,    // Ethereum
    target_token: eth_usdc
)
// 此binding用于：用户在Solana调用transfer_tokens

// 在Solana链上注册：Ethereum USDC → Solana USDC (入站，用于验证)
register_token_binding(
    source_chain: 1,    // Ethereum
    source_token: eth_usdc,
    target_chain: 900,  // Solana
    target_token: sol_usdc
)
// 此binding用于：Relayer在Solana调用complete_transfer时验证

// 多对多：同一源代币可以绑定到多个目标代币
register_token_binding(900, sol_usdc, 1, eth_usdc)    // → Ethereum USDC
register_token_binding(900, sol_usdc, 1, eth_usdt)    // → Ethereum USDT
register_token_binding(900, sol_usdc, 56, bsc_busd)   // → BSC BUSD
register_token_binding(900, sol_usdc, 137, poly_usdc) // → Polygon USDC
```

**双向跨链需要**：
```
在Solana链上注册2个binding：
  1. [900, sol_usdc, 1, eth_usdc] - 出站
  2. [1, eth_usdc, 900, sol_usdc] - 入站（验证用）

在Ethereum链上也注册2个binding：
  1. [1, eth_usdc, 900, sol_usdc] - 出站
  2. [900, sol_usdc, 1, eth_usdc] - 入站（验证用）
```

---

#### 2.2.4 register_bidirectional_binding

**功能**: 注册**双向对称**代币映射关系（管理员接口）

> **推荐**：此接口自动在本链注册双向binding，简化配置流程

**接口**:
```rust
pub fn register_bidirectional_binding(
    ctx: Context<RegisterBidirectionalBinding>,
    local_chain: u16,
    local_token: [u8; 32],
    remote_chain: u16,
    remote_token: [u8; 32],
    outbound_rate_num: u64,
    outbound_rate_denom: u64,
    inbound_rate_num: u64,
    inbound_rate_denom: u64,
) -> Result<()>
```

**参数**:
- `local_chain`: 本链ID（Solana=900）
- `local_token`: 本链代币地址
- `remote_chain`: 远程链ID（如1=Ethereum, 56=BSC, 137=Polygon）
- `remote_token`: 远程链代币地址
- `outbound_rate_num/denom`: 出站兑换比率（本链→远程链）
- `inbound_rate_num/denom`: 入站兑换比率（远程链→本链）

**权限**: 仅管理员可调用

**功能说明**:
此接口会自动创建**两个TokenBinding**：
```rust
// 1. 出站binding (local → remote)
TokenBinding {
    source_chain: local_chain,
    source_token: local_token,
    target_chain: remote_chain,
    target_token: remote_token,
    rate_numerator: outbound_rate_num,
    rate_denominator: outbound_rate_denom,
}

// 2. 入站binding (remote → local)
TokenBinding {
    source_chain: remote_chain,
    source_token: remote_token,
    target_chain: local_chain,
    target_token: local_token,
    rate_numerator: inbound_rate_num,
    rate_denominator: inbound_rate_denom,
}
```

**账户结构**:
```rust
#[derive(Accounts)]
#[instruction(
    local_chain: u16, 
    local_token: [u8; 32], 
    remote_chain: u16, 
    remote_token: [u8; 32]
)]
pub struct RegisterBidirectionalBinding<'info> {
    #[account(mut)]
    pub bridge_config: Account<'info, BridgeConfig>,
    
    // 出站binding
    #[account(
        init,
        payer = payer,
        space = TokenBinding::LEN,
        seeds = [
            b"TokenBinding",
            local_chain.to_le_bytes().as_ref(),
            local_token.as_ref(),
            remote_chain.to_le_bytes().as_ref(),
            remote_token.as_ref(),
        ],
        bump
    )]
    pub outbound_binding: Account<'info, TokenBinding>,
    
    // 入站binding
    #[account(
        init,
        payer = payer,
        space = TokenBinding::LEN,
        seeds = [
            b"TokenBinding",
            remote_chain.to_le_bytes().as_ref(),
            remote_token.as_ref(),
            local_chain.to_le_bytes().as_ref(),
            local_token.as_ref(),
        ],
        bump
    )]
    pub inbound_binding: Account<'info, TokenBinding>,
    
    pub authority: Signer<'info>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}
```

**使用示例**:
```rust
// 在Solana链上一次性注册双向USDC<->USDC binding
register_bidirectional_binding(
    local_chain: 900,    // Solana
    local_token: sol_usdc,
    remote_chain: 1,     // Ethereum
    remote_token: eth_usdc,
    outbound_rate_num: 1,    // Solana→Ethereum: 1:1
    outbound_rate_denom: 1,
    inbound_rate_num: 1,     // Ethereum→Solana: 1:1
    inbound_rate_denom: 1,
)

// 自动创建：
// ✅ [900, sol_usdc, 1, eth_usdc] - 出站
// ✅ [1, eth_usdc, 900, sol_usdc] - 入站

// 支持不对称兑换比率（考虑手续费等）
register_bidirectional_binding(
    local_chain: 900,
    local_token: sol_usdc,
    remote_chain: 1,
    remote_token: eth_usdt,
    outbound_rate_num: 998,   // 出站: 1 USDC = 0.998 USDT
    outbound_rate_denom: 1000,
    inbound_rate_num: 1002,   // 入站: 1 USDT = 1.002 USDC (反向)
    inbound_rate_denom: 1000,
)
```

**注意事项**:
1. 仍需在**对方链**上也执行相同的双向注册
2. 双向比率可以不对称（考虑流动性、手续费等因素）
3. 此接口简化了本链配置，但不能跨链操作

---

#### 2.2.5 set_exchange_rate

**功能**: 设置代币跨链兑换比率（管理员接口）

**接口**:
```rust
pub fn set_exchange_rate(
    ctx: Context<SetExchangeRate>,
    source_chain: u16,
    source_token: [u8; 32],
    target_chain: u16,
    rate_numerator: u64,
    rate_denominator: u64,
) -> Result<()>
```

**参数**:
- `source_chain`: 源链ID
- `source_token`: 源链代币地址
- `target_chain`: 目标链ID
- `rate_numerator`: 兑换比率分子
- `rate_denominator`: 兑换比率分母

**兑换计算**:
```rust
target_amount = source_amount * rate_numerator / rate_denominator
```

**权限**: 仅管理员可调用

**示例**:
```rust
// 设置 1 USDC = 1 USDT (1:1兑换)
set_exchange_rate(
    source_chain: 2,  // Solana
    source_token: usdc_mint,
    target_chain: 1,  // Ethereum
    rate_numerator: 1,
    rate_denominator: 1
)

// 设置 1 DOGE = 0.08 BTC (1:0.08兑换)
set_exchange_rate(
    source_chain: 3,  // Dogecoin
    source_token: doge_address,
    target_chain: 1,  // Bitcoin
    rate_numerator: 8,
    rate_denominator: 100
)
```

**账户结构**:
```rust
#[derive(Accounts)]
pub struct SetExchangeRate<'info> {
    #[account(
        mut,
        seeds = [
            b"TokenBinding",
            source_chain.to_le_bytes().as_ref(),
            source_token.as_ref(),
            target_chain.to_le_bytes().as_ref(),
        ],
        bump
    )]
    pub token_binding: Account<'info, TokenBinding>,
    
    pub authority: Signer<'info>,
}
```

---

#### 2.2.5 update_amm_config

**功能**: 配置外部AMM接口用于动态定价（预留接口）

**接口**:
```rust
pub fn update_amm_config(
    ctx: Context<UpdateAMMConfig>,
    source_chain: u16,
    source_token: [u8; 32],
    target_chain: u16,
    amm_program_id: Pubkey,
    use_external_price: bool,
) -> Result<()>
```

**参数**:
- `source_chain`: 源链ID
- `source_token`: 源链代币地址
- `target_chain`: 目标链ID
- `amm_program_id`: 外部AMM程序ID（如Raydium、Orca）
- `use_external_price`: 是否使用外部价格（true=AMM, false=固定比率）

**权限**: 仅管理员可调用

**预留设计**:
```rust
// 未来可能调用的AMM接口
if token_binding.use_external_price {
    let amm_price = invoke_amm_oracle(
        token_binding.amm_program_id,
        source_token,
        target_token
    )?;
    target_amount = source_amount * amm_price;
} else {
    // 使用固定比率
    target_amount = source_amount * rate_numerator / rate_denominator;
}
```

**示例**:
```rust
// 启用Raydium AMM动态定价
update_amm_config(
    source_chain: 2,
    source_token: usdc_mint,
    target_chain: 1,
    amm_program_id: RaydiumProgramId,
    use_external_price: true
)

// 恢复使用固定比率
update_amm_config(
    source_chain: 2,
    source_token: usdc_mint,
    target_chain: 1,
    amm_program_id: Pubkey::default(),
    use_external_price: false
)
```

---

## 3. 数据结构定义

### 3.1 核心账户结构

#### Bridge账户
```rust
#[account]
pub struct Bridge {
    pub guardian_set_index: u32,
    pub guardian_set_expiry: u32,
    pub message_fee: u64,
    pub paused: bool,
}
```

#### GuardianSet账户
```rust
#[account]
pub struct GuardianSet {
    pub index: u32,
    pub guardians: Vec<[u8; 20]>,  // 最多19个
    pub creation_time: i64,
    pub expiration_time: u32,      // 0 = active
}
```

#### PostedMessage账户
```rust
#[account]
pub struct PostedMessage {
    pub consistency_level: u8,
    pub emitter: Pubkey,
    pub sequence: u64,
    pub timestamp: u32,
    pub nonce: u32,
    pub payload: Vec<u8>,
}
```

#### PostedVAA账户
```rust
#[account]
pub struct PostedVAA {
    pub vaa_version: u8,
    pub guardian_set_index: u32,
    pub timestamp: u32,
    pub nonce: u32,
    pub emitter_chain: u16,
    pub emitter_address: [u8; 32],
    pub sequence: u64,
    pub consistency_level: u8,
    pub payload: Vec<u8>,
    pub consumed: bool,
}
```

---

### 3.2 Payload结构

#### TokenTransfer Payload（新版本 - 支持跨链兑换）

```rust
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct TokenTransferPayload {
    // 基础字段
    pub payload_type: u8,           // 1 = token transfer with exchange
    pub amount: u64,                // 源链锁定数量
    pub token_address: [u8; 32],    // 源链代币地址
    pub token_chain: u16,           // 源链ID
    pub recipient: [u8; 32],        // 接收者地址
    pub recipient_chain: u16,       // 目标链ID
    
    // 新增兑换字段
    pub target_token: [u8; 32],     // 目标链代币地址
    pub target_amount: u64,         // 目标链接收数量
    pub exchange_rate_num: u64,     // 兑换比率分子
    pub exchange_rate_denom: u64,   // 兑换比率分母
}
```

**字节布局**:
```
Offset  Size  Field
------  ----  -----
0       1     payload_type
1       8     amount (big-endian u64)
9       32    token_address
41      2     token_chain (big-endian u16)
43      32    recipient
75      2     recipient_chain (big-endian u16)
77      32    target_token (新增)
109     8     target_amount (新增, big-endian u64)
117     8     exchange_rate_num (新增, big-endian u64)
125     8     exchange_rate_denom (新增, big-endian u64)
------
总计: 133字节
```

**编码示例**:
```rust
// 示例1: USDC → USDC (同币种)
let payload = TokenTransferPayload {
    payload_type: 1,
    amount: 1000_000_000,  // 1000 USDC (6 decimals)
    token_address: sol_usdc_mint.to_bytes(),
    token_chain: 2,  // Solana
    recipient: eth_address,
    recipient_chain: 1,  // Ethereum
    target_token: eth_usdc_address,
    target_amount: 1000_000_000,  // 1000 USDC (1:1)
    exchange_rate_num: 1,
    exchange_rate_denom: 1,
}.try_to_vec()?;

// 示例2: USDC → USDT (不同币种)
let payload = TokenTransferPayload {
    payload_type: 1,
    amount: 1000_000_000,  // 1000 USDC
    token_address: sol_usdc_mint.to_bytes(),
    token_chain: 2,  // Solana
    recipient: eth_address,
    recipient_chain: 1,  // Ethereum
    target_token: eth_usdt_address,
    target_amount: 998_000_000,  // 998 USDT (1:0.998)
    exchange_rate_num: 998,
    exchange_rate_denom: 1000,
}.try_to_vec()?;
```

**Payload长度验证**:
```rust
// 验证payload长度
pub fn validate_payload(payload: &[u8]) -> Result<()> {
    require!(
        payload.len() == 133,
        TokenBridgeError::InvalidPayloadLength
    );
    Ok(())
}
```

---

### 3.3 Sequence账户
```rust
#[account]
pub struct Sequence {
    pub sequence: u64,
}
```

**PDA推导**:
```rust
let (sequence_pda, _) = Pubkey::find_program_address(
    &[
        b"Sequence",
        emitter.key().as_ref(),
    ],
    program_id
);
```

---

### 3.4 VaaBuffer账户（新增 - 用于大VAA传递）

**功能**: 临时存储VAA数据，支持分块写入

```rust
#[account]
pub struct VaaBuffer {
    /// VAA总大小
    pub total_size: u32,
    
    /// 当前已写入字节数
    pub written_size: u32,
    
    /// VAA数据（动态大小，最大2048字节）
    pub data: Vec<u8>,
    
    /// 是否已完成写入
    pub finalized: bool,
}

impl VaaBuffer {
    pub const MAX_SIZE: usize = 4 + 4 + (4 + 2048) + 1;
}
```

**PDA推导**:
```rust
// 使用随机nonce避免冲突
let (vaa_buffer_pda, _) = Pubkey::find_program_address(
    &[
        b"VaaBuffer",
        payer.key().as_ref(),
        &nonce.to_le_bytes(),
    ],
    program_id
);
```

**使用流程**:
```typescript
// 1. 初始化缓冲区
await program.methods.initVaaBuffer(1072)
    .accounts({ vaaBuffer, payer })
    .rpc();

// 2. 分块写入VAA（每块≤900字节）
await program.methods.appendVaaChunk(vaa.slice(0, 900), 0)
    .accounts({ vaaBuffer, payer })
    .rpc();
    
await program.methods.appendVaaChunk(vaa.slice(900, 1072), 900)
    .accounts({ vaaBuffer, payer })
    .rpc();

// 3. 验证并发布VAA
await program.methods.postVaa()
    .accounts({ vaaBuffer, guardianSet, postedVaa })
    .rpc();
```

---

### 3.5 TokenBinding账户

**功能**: 存储代币跨链映射关系和兑换配置

```rust
#[account]
pub struct TokenBinding {
    /// 源链ID
    pub source_chain: u16,
    
    /// 源链代币地址（32字节统一格式）
    pub source_token: [u8; 32],
    
    /// 目标链ID
    pub target_chain: u16,
    
    /// 目标链代币地址（32字节统一格式）
    pub target_token: [u8; 32],
    
    /// 兑换比率分子
    pub rate_numerator: u64,
    
    /// 兑换比率分母
    pub rate_denominator: u64,
    
    /// 是否启用外部AMM定价
    pub use_external_price: bool,
    
    /// 外部AMM程序ID（预留）
    pub amm_program_id: Pubkey,
    
    /// 是否启用
    pub enabled: bool,
    
    /// 创建时间
    pub created_at: i64,
    
    /// 最后更新时间
    pub updated_at: i64,
}

impl TokenBinding {
    pub const LEN: usize = 8 + // discriminator
        2 + // source_chain
        32 + // source_token
        2 + // target_chain
        32 + // target_token
        8 + // rate_numerator
        8 + // rate_denominator
        1 + // use_external_price
        32 + // amm_program_id
        1 + // enabled
        8 + // created_at
        8; // updated_at
}
```

**PDA推导**:
```rust
// 支持多对多：PDA包含完整的4元组
let (token_binding_pda, _) = Pubkey::find_program_address(
    &[
        b"TokenBinding",
        source_chain.to_le_bytes().as_ref(),  // 源链
        source_token.as_ref(),                // 源代币
        target_chain.to_le_bytes().as_ref(),  // 目标链
        target_token.as_ref(),                // 目标代币（新增）
    ],
    program_id
);
```

**使用示例**:
```rust
// 示例：查询Solana USDC → Ethereum USDT的兑换比率
let binding_pda = Pubkey::find_program_address(
    &[
        b"TokenBinding",
        900u16.to_le_bytes().as_ref(),  // Solana
        sol_usdc.as_ref(),
        1u16.to_le_bytes().as_ref(),    // Ethereum
        eth_usdt.as_ref(),
    ],
    &token_bridge_program_id,
).0;

let binding = program.account::<TokenBinding>(binding_pda).await?;
let target_amount = source_amount
    .checked_mul(binding.rate_numerator).unwrap()
    .checked_div(binding.rate_denominator).unwrap();

// 同一源代币可以有多个binding：
// [900, sol_usdc, 1, eth_usdc]    → rate 1:1
// [900, sol_usdc, 1, eth_usdt]    → rate 998:1000
// [900, sol_usdc, 56, bsc_busd]   → rate 999:1000
// [900, sol_usdc, 137, poly_usdc] → rate 1:1
```

---

### 3.5 BridgeConfig账户

**功能**: 存储桥接全局配置和管理员权限

```rust
#[account]
pub struct BridgeConfig {
    /// 管理员公钥
    pub authority: Pubkey,
    
    /// 是否启用跨链兑换功能
    pub exchange_enabled: bool,
    
    /// 默认兑换手续费（基点，10000=100%）
    pub default_fee_bps: u16,
    
    /// 手续费接收账户
    pub fee_recipient: Pubkey,
    
    /// 暂停状态
    pub paused: bool,
}

impl BridgeConfig {
    pub const LEN: usize = 8 + 32 + 1 + 2 + 32 + 1;
}
```

---

### 3.6 WrappedMeta账户（已弃用）

> **注意**: 该账户结构在新设计中已被TokenBinding替代。
> 新设计不再创建包装代币，而是绑定到已有代币。

```rust
// 旧设计（已弃用）
#[account]
pub struct WrappedMeta {
    pub original_chain: u16,
    pub original_address: [u8; 32],
    pub decimals: u8,
}
```

---

## 4. 错误码规范

### 4.1 程序错误定义

```rust
#[error_code]
pub enum BridgeError {
    #[msg("Invalid VAA")]
    InvalidVAA,
    
    #[msg("VAA already consumed")]
    VAAAlreadyConsumed,
    
    #[msg("Insufficient signatures (requires 13/19)")]
    InsufficientSignatures,
    
    #[msg("Invalid guardian set")]
    InvalidGuardianSet,
    
    #[msg("Guardian set expired")]
    GuardianSetExpired,
    
    #[msg("Invalid signature")]
    InvalidSignature,
    
    #[msg("Bridge is paused")]
    BridgePaused,
    
    #[msg("Insufficient fee")]
    InsufficientFee,
    
    #[msg("Invalid target chain")]
    InvalidTargetChain,
    
    #[msg("Amount too large")]
    AmountTooLarge,
}
```

---

### 4.2 Token Bridge错误

```rust
#[error_code]
pub enum TokenBridgeError {
    #[msg("Invalid token account")]
    InvalidTokenAccount,
    
    #[msg("Insufficient balance")]
    InsufficientBalance,
    
    #[msg("Invalid payload")]
    InvalidPayload,
    
    // 代币绑定相关错误
    #[msg("Token binding not found")]
    TokenBindingNotFound,
    
    #[msg("Token binding already exists")]
    TokenBindingExists,
    
    #[msg("Token binding not enabled")]
    TokenBindingNotEnabled,
    
    #[msg("Invalid exchange rate")]
    InvalidExchangeRate,
    
    #[msg("Exchange rate denominator cannot be zero")]
    ZeroDenominator,
    
    #[msg("Target token mismatch")]
    TargetTokenMismatch,
    
    #[msg("Exchange feature disabled")]
    ExchangeDisabled,
    
    #[msg("Unauthorized: not bridge authority")]
    Unauthorized,
    
    #[msg("AMM price fetch failed")]
    AMMPriceFetchFailed,
    
    #[msg("Slippage exceeded")]
    SlippageExceeded,
}
```

---

## 5. 与其他模块的集成

### 5.1 与Guardian的集成

**Guardian监听Solana交易**:

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
                // 提取消息信息
                let observation = parse_message_published_log(&log);
                
                // 签名并广播
                let signature = sign_observation(&observation);
                broadcast_to_p2p(observation, signature).await;
            }
        }
    }
}
```

**日志格式**:
```
Program log: MessagePublished: emitter=7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs, sequence=42, nonce=12345, consistency_level=32, payload=0x01000000...
```

---

### 5.2 与Relayer的集成

**Relayer提交VAA到Solana**:

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
            bridge: bridge_pda,
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

### 5.3 账户初始化

**initialize指令**:
```rust
pub fn initialize(
    ctx: Context<Initialize>,
    guardian_set_index: u32,
    guardians: Vec<[u8; 20]>,
    message_fee: u64,
) -> Result<()> {
    let bridge = &mut ctx.accounts.bridge;
    bridge.guardian_set_index = guardian_set_index;
    bridge.message_fee = message_fee;
    bridge.paused = false;
    
    let guardian_set = &mut ctx.accounts.guardian_set;
    guardian_set.index = guardian_set_index;
    guardian_set.guardians = guardians;
    guardian_set.creation_time = Clock::get()?.unix_timestamp;
    guardian_set.expiration_time = 0;  // Active
    
    Ok(())
}
```

---

## 附录

### A. 实现注意事项（2025-11-09）

#### A.1 计算预算要求

**VAA签名验证计算密集**：
```typescript
// 调用postVaa时必须增加计算预算
await program.methods
  .postVaa(emitterChain, emitterAddr, sequence)
  .preInstructions([
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })
  ])
  .rpc();
```

**原因**：
- 13个secp256k1签名恢复需要约1.2M CU
- 默认200K CU会导致"Computational budget exceeded"错误
- 生产环境建议：1.4M ~ 2M CU

#### A.2 跨程序账户修改限制

**PostedVAA.consumed标记**：
```rust
// token-bridge中修改solana-core的账户
posted_vaa.consumed = true;  // ⚠️ 可能不生效
```

**已知问题**：
- PostedVAA所有者是solana-core程序
- 跨程序修改需要特殊约束或CPI调用
- 当前测试中此字段修改未生效

**待实现方案**（之一）：
```rust
// 方案：在solana-core添加mark_consumed指令
pub fn mark_vaa_consumed(ctx: Context<MarkConsumed>) -> Result<()> {
    ctx.accounts.posted_vaa.consumed = true;
    Ok(())
}

// token-bridge通过CPI调用
solana_core::cpi::mark_vaa_consumed(cpi_ctx)?;
```

#### A.3 Guardian升级账户设计

**UpdateGuardianSet账户**：
```rust
pub struct UpdateGuardianSet<'info> {
    // new_guardian_set和upgrade_vaa使用Keypair（非PDA）
    #[account(init, payer = payer, space = ...)]
    pub new_guardian_set: Account<'info, GuardianSet>,
    
    #[account(init, payer = payer, space = ...)]
    pub upgrade_vaa: Account<'info, PostedVAA>,
}
```

**测试调用**：
```typescript
const newSetKeypair = Keypair.generate();
const vaaKeypair = Keypair.generate();

await program.methods
  .updateGuardianSet()
  .accounts({
    newGuardianSet: newSetKeypair.publicKey,
    upgradeVaa: vaaKeypair.publicKey,
    ...
  })
  .signers([payer, newSetKeypair, vaaKeypair])
  .rpc();
```

---

### B. 程序ID（示例）

```
solana-core:    worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth
token-bridge:   wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb
```

### B. PDA推导规则

```rust
// Bridge PDA
let (bridge_pda, _) = Pubkey::find_program_address(
    &[b"Bridge"],
    program_id
);

// GuardianSet PDA
let (guardian_set_pda, _) = Pubkey::find_program_address(
    &[b"GuardianSet", guardian_set_index.to_le_bytes().as_ref()],
    program_id
);

// PostedVAA PDA
let (vaa_pda, _) = Pubkey::find_program_address(
    &[b"PostedVAA", vaa_hash.as_ref()],
    program_id
);
```

### C. 链ID规范

**采用主流Chain ID标识**（与EVM生态保持一致）：

| Chain ID | 网络 | 类型 |
|----------|------|------|
| 1 | Ethereum Mainnet | EVM |
| 56 | BSC (Binance Smart Chain) | EVM |
| 137 | Polygon | EVM |
| 43114 | Avalanche C-Chain | EVM |
| 42161 | Arbitrum One | EVM |
| 10 | Optimism | EVM |
| 8453 | Base | EVM |
| 250 | Fantom | EVM |
| 100 | Gnosis Chain | EVM |
| 1101 | Polygon zkEVM | EVM |
| 324 | zkSync Era | EVM |
| ... | 其他EVM链 | EVM |

**Solana链ID**：
```
Chain ID: 900  // Solana Mainnet
Chain ID: 901  // Solana Devnet
Chain ID: 902  // Solana Testnet
```
> 选择900系列避免与现有EVM链冲突

**本地测试链ID**（使用极大魔数防止冲突）：
```
Chain ID范围: 0xFFF0 - 0xFFFF (65520-65535)

推荐分配：
- 0xFFF0 (65520): Local Ethereum (Hardhat/Anvil)
- 0xFFF1 (65521): Local Solana (solana-test-validator)
- 0xFFF2 (65522): Local BSC
- 0xFFF3 (65523): Local Polygon
- ...
- 0xFFFF (65535): 预留
```

**参考资源**：
- EVM Chain IDs: https://chainlist.org/
- Ethereum Chain IDs: https://github.com/ethereum-lists/chains

---

**文档状态**: ✅ v1.1 已更新（含实现状态）  
**维护者**: Solana合约开发团队  
**实现进度**: 
- ✅ solana-core: 100%实现（含签名验证）
- ✅ token-bridge: 100%实现（含兑换功能）
- 🔄 待完善：Guardian升级、跨程序VAA consumed标记
