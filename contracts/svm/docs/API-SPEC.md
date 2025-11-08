# Solana 合约子模块 - API规格说明书

> **文档版本**: v1.0  
> **创建日期**: 2025-11-08  
> **子模块范围**: Solana程序接口规范

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
    ├── transfer_tokens   # 锁定SPL代币发起跨链
    ├── complete_transfer # 完成跨链转账
    └── create_wrapped    # 创建包装代币
```

### 1.2 支持的功能

| 功能 | 程序 | 说明 |
|------|------|------|
| 发送跨链消息 | solana-core | 锁定SPL代币后发送消息 |
| 接收VAA | solana-core | 验证Guardian签名 |
| Guardian升级 | solana-core | 同步更新Guardian Set |
| SPL代币跨链 | token-bridge | 锁定/解锁SPL代币 |
| 包装代币铸造 | token-bridge | 铸造来自EVM链的代币 |

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

#### 2.1.2 post_vaa

**功能**: 接收并验证来自EVM链的VAA

**接口**:
```rust
pub fn post_vaa(
    ctx: Context<PostVAA>,
    vaa: Vec<u8>,
) -> Result<()>
```

**参数**:
- `vaa`: 经过Guardian签名的VAA字节数组

**验证步骤**:
1. 解析VAA结构（header + signatures + body）
2. 验证Guardian签名（使用Ed25519或secp256k1指令）
3. 检查签名数量 ≥ 门限（13/19）
4. 检查Guardian Set索引有效
5. 检查VAA未被消费
6. 存储到PostedVAA账户

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

#### 2.1.3 update_guardian_set

**功能**: 升级Guardian Set（管理员接口）

**接口**:
```rust
pub fn update_guardian_set(
    ctx: Context<UpdateGuardianSet>,
    vaa: Vec<u8>,
) -> Result<()>
```

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

**功能**: 锁定SPL代币并发起跨链转账到EVM

**接口**:
```rust
pub fn transfer_tokens(
    ctx: Context<TransferTokens>,
    amount: u64,
    target_chain: u16,
    recipient: [u8; 32],
) -> Result<()>
```

**参数**:
- `amount`: 转账数量
- `target_chain`: 目标链ID（1=Ethereum, 56=BSC）
- `recipient`: 接收者地址（32字节格式）

**账户结构**:
```rust
#[derive(Accounts)]
pub struct TransferTokens<'info> {
    #[account(mut)]
    pub bridge: Account<'info, Bridge>,
    
    #[account(mut)]
    pub token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub custody_account: Account<'info, TokenAccount>,
    
    pub token_authority: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
}
```

**流程**:
1. 转账SPL代币到custody账户（锁定）
2. 构造TokenTransfer payload
3. 调用solana-core的post_message
4. 返回序列号

**手续费**: 0.002 SOL（包含post_message费用）

---

#### 2.2.2 complete_transfer

**功能**: 完成跨链转账（解锁或铸造SPL代币）

**接口**:
```rust
pub fn complete_transfer(
    ctx: Context<CompleteTransfer>,
    vaa: Vec<u8>,
) -> Result<()>
```

**流程**:
1. 验证VAA（调用post_vaa）
2. 解析TokenTransfer payload
3. 检查目标链 = Solana（chain_id=2）
4. 判断是原生代币还是包装代币
   - 原生: 从custody解锁
   - 包装: 铸造wrapped token
5. 转账到接收者
6. 标记VAA已消费

**账户结构**:
```rust
#[derive(Accounts)]
pub struct CompleteTransfer<'info> {
    #[account(mut)]
    pub bridge: Account<'info, Bridge>,
    
    #[account(mut)]
    pub posted_vaa: Account<'info, PostedVAA>,
    
    #[account(mut)]
    pub recipient_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub custody_or_mint: AccountInfo<'info>,
    
    pub token_program: Program<'info, Token>,
}
```

---

#### 2.2.3 create_wrapped

**功能**: 首次跨链某EVM代币时，创建包装SPL代币

**接口**:
```rust
pub fn create_wrapped(
    ctx: Context<CreateWrapped>,
    chain: u16,
    token_address: [u8; 32],
    decimals: u8,
) -> Result<()>
```

**参数**:
- `chain`: 源链ID（如1=Ethereum）
- `token_address`: 源链代币地址
- `decimals`: 精度

**创建内容**:
- 创建SPL Mint账户
- 设置mint authority = token_bridge程序
- 创建WrappedMeta账户存储元数据
- 命名规则: "Wrapped {Symbol} (Wormhole)"

**示例**:
```rust
// Ethereum USDC跨链到Solana
create_wrapped(
    chain: 1,
    token_address: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48,
    decimals: 6
)
// → 创建 wrappedUSDC (SPL Token)
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

#### TokenTransfer Payload
```rust
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct TokenTransferPayload {
    pub payload_type: u8,      // 1 = token transfer
    pub amount: u64,
    pub token_address: [u8; 32],
    pub token_chain: u16,
    pub recipient: [u8; 32],
    pub recipient_chain: u16,
}
```

**编码方式**:
```rust
let payload = TokenTransferPayload {
    payload_type: 1,
    amount: 1000000000,  // 1000 USDC (6 decimals)
    token_address: usdc_mint.to_bytes(),
    token_chain: 2,  // Solana
    recipient: eth_address,
    recipient_chain: 1,  // Ethereum
}.try_to_vec()?;
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

### 3.4 WrappedMeta账户
```rust
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
    
    #[msg("Wrapped token already exists")]
    WrappedTokenExists,
    
    #[msg("Invalid payload")]
    InvalidPayload,
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

### A. 程序ID（示例）

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

### C. Solana链ID

```
Mainnet: 2
Devnet:  2 (相同)
```

---

**文档状态**: ✅ v1.0 初版完成  
**维护者**: Solana合约开发团队
