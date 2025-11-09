# Solana 合约子模块 - 测试套件规划

> **文档版本**: v1.0  
> **创建日期**: 2025-11-08  
> **子模块范围**: Solana程序测试规范

---

## 📋 目录

1. [测试策略](#1-测试策略)
2. [程序单元测试](#2-程序单元测试)
3. [程序集成测试](#3-程序集成测试)
4. [跨链E2E测试](#4-跨链e2e测试)
5. [测试环境配置](#5-测试环境配置)

---

## 1. 测试策略

### 1.1 测试分层

```
┌──────────────────────────────────────────┐
│  E2E测试 (跨链完整流程)                    │  20%
│  - Solana → Ethereum                      │
│  - Ethereum → Solana                      │
└──────────────────────────────────────────┘
                 ↓
┌──────────────────────────────────────────┐
│  程序集成测试                             │  30%
│  - solana-core + token-bridge             │
│  - 多指令交互                             │
└──────────────────────────────────────────┘
                 ↓
┌──────────────────────────────────────────┐
│  程序单元测试                             │  50%
│  - 各指令独立测试                         │
│  - 边界条件和错误处理                     │
└──────────────────────────────────────────┘
```

### 1.2 测试覆盖目标

| 测试类型 | 覆盖率目标 | 用例数 | 预计时间 |
|---------|-----------|--------|---------|
| **程序单元测试** | 90%代码 | 53个 | 22分钟 |
| **集成测试** | 80%流程 | 6个 | 10分钟 |
| **E2E测试** | 100%关键流程 | 7个 | 20分钟 |
| **总计** | - | **66个** | **52分钟** |

> **注**：已完全移除wrapped token相关测试，采用token binding方案（Lock/Unlock模式）

---

## 2. 程序单元测试

### 2.1 solana-core 单元测试

#### 2.1.1 initialize指令测试

| 测试ID | 测试场景 | 优先级 |
|-------|---------|--------|
| UNIT-SC-001 | 正常初始化Bridge | P0 |
| UNIT-SC-002 | 初始化Guardian Set | P0 |
| UNIT-SC-003 | 设置初始message_fee | P0 |
| UNIT-SC-004 | 重复初始化失败 | P0 |

**测试示例 UNIT-SC-001**:
```rust
#[tokio::test]
async fn test_initialize_bridge() {
    let program = setup_program().await;
    
    // 准备Guardian列表
    let guardians = vec![
        guardian_address_1(),
        guardian_address_2(),
        // ... 19个Guardian
    ];
    
    // 调用initialize
    let tx = program.methods()
        .initialize(0, guardians.clone(), 1_000_000)
        .accounts({
            bridge: bridge_pda,
            guardian_set: guardian_set_pda,
            payer: payer.pubkey(),
            system_program: system_program::ID,
        })
        .signer(&payer)
        .rpc()
        .await;
    
    assert!(tx.is_ok());
    
    // 验证Bridge账户
    let bridge = program.account::<Bridge>(bridge_pda).await?;
    assert_eq!(bridge.guardian_set_index, 0);
    assert_eq!(bridge.message_fee, 1_000_000);
    assert_eq!(bridge.paused, false);
    
    // 验证GuardianSet账户
    let guardian_set = program.account::<GuardianSet>(guardian_set_pda).await?;
    assert_eq!(guardian_set.guardians.len(), 19);
    assert_eq!(guardian_set.guardians, guardians);
}
```

---

#### 2.1.2 post_message指令测试

| 测试ID | 测试场景 | 优先级 |
|-------|---------|--------|
| UNIT-SC-005 | 正常发送消息 | P0 |
| UNIT-SC-006 | 序列号递增 | P0 |
| UNIT-SC-007 | 手续费不足 | P0 |
| UNIT-SC-008 | payload大小限制 | P1 |
| UNIT-SC-009 | Bridge暂停时拒绝 | P0 |

**测试示例 UNIT-SC-005**:
```rust
#[tokio::test]
async fn test_post_message() {
    let program = setup_initialized_program().await;
    
    let payload = vec![1, 2, 3, 4, 5];
    let nonce = 12345u32;
    
    // 发送消息
    let tx = program.methods()
        .post_message(nonce, payload.clone(), 32)
        .accounts({
            bridge: bridge_pda,
            message: message_pda,
            emitter: emitter.pubkey(),
            sequence: sequence_pda,
            payer: payer.pubkey(),
            system_program: system_program::ID,
        })
        .signers([&emitter, &payer])
        .rpc()
        .await?;
    
    // 验证消息账户
    let message = program.account::<PostedMessage>(message_pda).await?;
    assert_eq!(message.nonce, nonce);
    assert_eq!(message.payload, payload);
    assert_eq!(message.consistency_level, 32);
    assert_eq!(message.sequence, 0);  // 第一条消息
    
    // 验证序列号递增
    let sequence = program.account::<Sequence>(sequence_pda).await?;
    assert_eq!(sequence.sequence, 1);
}
```

---

#### 2.1.3 post_vaa指令测试

| 测试ID | 测试场景 | 优先级 |
|-------|---------|--------|
| UNIT-SC-010 | 正常接收VAA | P0 |
| UNIT-SC-011 | VAA签名验证成功 | P0 |
| UNIT-SC-012 | 签名数量不足（<13） | P0 |
| UNIT-SC-013 | 无效签名 | P0 |
| UNIT-SC-014 | Guardian Set过期 | P0 |
| UNIT-SC-015 | VAA重复消费 | P0 |
| UNIT-SC-016 | 无效的VAA格式 | P1 |

**测试示例 UNIT-SC-010**:
```rust
#[tokio::test]
async fn test_post_vaa_success() {
    let program = setup_initialized_program().await;
    
    // 构造测试VAA（13个Guardian签名）
    let vaa = create_test_vaa(
        guardian_set_index: 0,
        emitter_chain: 1,  // Ethereum
        emitter_address: eth_bridge_address,
        sequence: 42,
        payload: token_transfer_payload,
        guardians: &test_guardians[0..13],  // 13个签名
    );
    
    // 提交VAA
    let tx = program.methods()
        .post_vaa(vaa.clone())
        .accounts({
            bridge: bridge_pda,
            guardian_set: guardian_set_pda,
            posted_vaa: posted_vaa_pda,
            payer: payer.pubkey(),
            system_program: system_program::ID,
        })
        .signer(&payer)
        .rpc()
        .await?;
    
    // 验证PostedVAA账户
    let posted_vaa = program.account::<PostedVAA>(posted_vaa_pda).await?;
    assert_eq!(posted_vaa.emitter_chain, 1);
    assert_eq!(posted_vaa.sequence, 42);
    assert_eq!(posted_vaa.consumed, false);
}
```

**测试示例 UNIT-SC-012**:
```rust
#[tokio::test]
async fn test_post_vaa_insufficient_signatures() {
    let program = setup_initialized_program().await;
    
    // 构造只有12个签名的VAA（需要13个）
    let vaa = create_test_vaa(
        guardian_set_index: 0,
        guardians: &test_guardians[0..12],  // 只有12个签名
        ...
    );
    
    // 应该失败
    let result = program.methods()
        .post_vaa(vaa)
        .accounts({ ... })
        .rpc()
        .await;
    
    assert!(result.is_err());
    assert_eq!(
        result.unwrap_err().to_string(),
        "Insufficient signatures (requires 13/19)"
    );
}
```

---

#### 2.1.4 update_guardian_set指令测试

| 测试ID | 测试场景 | 优先级 |
|-------|---------|--------|
| UNIT-SC-017 | 正常升级Guardian Set | P0 |
| UNIT-SC-018 | 新旧Set并存（过渡期） | P0 |
| UNIT-SC-019 | 旧Set过期后拒绝 | P0 |
| UNIT-SC-020 | 非治理VAA拒绝 | P0 |

**测试示例 UNIT-SC-017**:
```rust
#[tokio::test]
async fn test_update_guardian_set() {
    let program = setup_initialized_program().await;
    
    // 构造升级VAA（由旧Guardian Set签名）
    let new_guardians = generate_new_guardians(19);
    let payload = GuardianSetUpgradePayload {
        module: 0x01,
        action: 0x02,
        chain: 0,
        new_index: 1,
        new_guardians: new_guardians.clone(),
    };
    
    let vaa = create_governance_vaa(
        guardian_set_index: 0,
        payload: payload.serialize(),
        guardians: &current_guardians,
    );
    
    // 执行升级
    let tx = program.methods()
        .update_guardian_set(vaa)
        .accounts({
            bridge: bridge_pda,
            current_guardian_set: guardian_set_0_pda,
            new_guardian_set: guardian_set_1_pda,
            payer: payer.pubkey(),
            system_program: system_program::ID,
        })
        .signer(&payer)
        .rpc()
        .await?;
    
    // 验证Bridge更新
    let bridge = program.account::<Bridge>(bridge_pda).await?;
    assert_eq!(bridge.guardian_set_index, 1);
    
    // 验证新Set创建
    let new_set = program.account::<GuardianSet>(guardian_set_1_pda).await?;
    assert_eq!(new_set.index, 1);
    assert_eq!(new_set.guardians, new_guardians);
    assert_eq!(new_set.expiration_time, 0);  // Active
    
    // 验证旧Set设置过期时间（7天后）
    let old_set = program.account::<GuardianSet>(guardian_set_0_pda).await?;
    assert!(old_set.expiration_time > 0);
    assert_eq!(old_set.expiration_time, now + 7 * 86400);
}
```

---

### 2.2 token-bridge 单元测试

#### 2.2.1 transfer_tokens指令测试

| 测试ID | 测试场景 | 优先级 |
|-------|---------|--------|
| UNIT-TB-001 | 正常锁定SPL代币（1:1兑换） | P0 |
| UNIT-TB-002 | 跨链兑换不同代币（USDC→USDT） | P0 |
| UNIT-TB-003 | TokenBinding不存在失败 | P0 |
| UNIT-TB-004 | TokenBinding未启用失败 | P0 |
| UNIT-TB-005 | 授权不足 | P0 |
| UNIT-TB-006 | 余额不足 | P0 |
| UNIT-TB-007 | 手续费不足 | P0 |
| UNIT-TB-008 | 无效目标链 | P1 |

**测试示例 UNIT-TB-001: 正常锁定SPL代币（1:1兑换）**:
```rust
#[tokio::test]
async fn test_transfer_tokens_one_to_one() {
    let program = setup_token_bridge_program().await;
    
    // 创建测试代币
    let sol_usdc_mint = create_test_mint(&program, 6).await?;
    let user_token_account = create_token_account(&program, &sol_usdc_mint, &user).await?;
    mint_to(&program, &sol_usdc_mint, &user_token_account, 1000_000_000).await?;
    
    // 注册TokenBinding（Solana USDC → Ethereum USDC, 1:1）
    let eth_usdc = eth_usdc_address_bytes32();
    register_token_binding(
        &program,
        2, sol_usdc_mint.to_bytes(),
        1, eth_usdc,
        1, 1  // 1:1 rate
    ).await?;
    
    let amount = 500_000_000;  // 500 USDC
    let target_chain = 1;       // Ethereum
    let recipient = eth_address_bytes32();
    
    // 执行转账
    let tx = program.methods()
        .transfer_tokens(amount, target_chain, recipient)
        .accounts({
            bridge: bridge_pda,
            token_binding: token_binding_pda,
            token_account: user_token_account,
            custody_account: custody_pda,
            token_authority: user.pubkey(),
            token_mint: sol_usdc_mint,
            token_program: token_program::ID,
        })
        .signer(&user)
        .rpc()
        .await?;
    
    // 验证代币锁定
    let custody = get_token_account(&program, custody_pda).await?;
    assert_eq!(custody.amount, amount);
    
    // 验证用户余额减少
    let user_account = get_token_account(&program, user_token_account).await?;
    assert_eq!(user_account.amount, 500_000_000);
    
    // 验证消息发送
    let sequence = program.account::<Sequence>(sequence_pda).await?;
    assert_eq!(sequence.sequence, 1);
    
    // 验证payload包含兑换信息
    let message = program.account::<PostedMessage>(message_pda).await?;
    let payload = TokenTransferPayload::deserialize(&message.payload)?;
    assert_eq!(payload.amount, 500_000_000);
    assert_eq!(payload.target_token, eth_usdc);
    assert_eq!(payload.target_amount, 500_000_000);  // 1:1
    assert_eq!(payload.exchange_rate_num, 1);
    assert_eq!(payload.exchange_rate_denom, 1);
}
```

**测试示例 UNIT-TB-002: 跨链兑换不同代币**:
```rust
#[tokio::test]
async fn test_transfer_tokens_with_exchange() {
    let program = setup_token_bridge_program().await;
    
    // Solana USDC → Ethereum USDT (1:0.998兑换)
    let sol_usdc_mint = create_test_mint(&program, 6).await?;
    let user_token_account = create_token_account(&program, &sol_usdc_mint, &user).await?;
    mint_to(&program, &sol_usdc_mint, &user_token_account, 1000_000_000).await?;
    
    // 注册TokenBinding（USDC → USDT, 998:1000）
    let eth_usdt = eth_usdt_address_bytes32();
    register_token_binding(
        &program,
        2, sol_usdc_mint.to_bytes(),
        1, eth_usdt,
        998, 1000  // 1 USDC = 0.998 USDT
    ).await?;
    
    let amount = 1000_000_000;  // 1000 USDC
    
    // 执行转账
    let tx = program.methods()
        .transfer_tokens(amount, 1, eth_recipient)
        .accounts({ ... })
        .rpc()
        .await?;
    
    // 验证payload
    let message = program.account::<PostedMessage>(message_pda).await?;
    let payload = TokenTransferPayload::deserialize(&message.payload)?;
    assert_eq!(payload.amount, 1000_000_000);  // 源链1000 USDC
    assert_eq!(payload.target_token, eth_usdt);  // 目标是USDT
    assert_eq!(payload.target_amount, 998_000_000);  // 目标链998 USDT
    assert_eq!(payload.exchange_rate_num, 998);
    assert_eq!(payload.exchange_rate_denom, 1000);
}
```

**测试示例 UNIT-TB-003: TokenBinding不存在失败**:
```rust
#[tokio::test]
async fn test_transfer_tokens_no_binding() {
    let program = setup_token_bridge_program().await;
    
    // 未注册TokenBinding的代币
    let unknown_mint = create_test_mint(&program, 6).await?;
    
    let result = program.methods()
        .transfer_tokens(1000_000_000, 1, eth_recipient)
        .accounts({
            token_binding: token_binding_pda,  // PDA不存在
            ...
        })
        .rpc()
        .await;
    
    assert!(result.is_err());
    assert_eq!(
        result.unwrap_err().to_string(),
        "Token binding not found"
    );
}
```

---

#### 2.2.2 complete_transfer指令测试

| 测试ID | 测试场景 | 优先级 |
|-------|---------|--------|
| UNIT-TB-009 | 解锁原生SPL代币（1:1兑换） | P0 |
| UNIT-TB-010 | 跨链兑换不同代币接收 | P0 |
| UNIT-TB-025 | 兑换比率验证失败 | P0 |
| UNIT-TB-026 | 目标代币不匹配 | P0 |
| UNIT-TB-027 | VAA验证失败 | P0 |
| UNIT-TB-028 | 目标链不匹配 | P0 |
| UNIT-TB-029 | custody余额不足 | P0 |

**测试示例 UNIT-TB-009: 解锁原生SPL代币（1:1兑换）**:
```rust
#[tokio::test]
async fn test_complete_transfer_unlock_one_to_one() {
    let program = setup_token_bridge_program().await;
    
    // 预先在custody锁定代币
    let sol_usdc_mint = create_test_mint(&program, 6).await?;
    let custody_amount = 1000_000_000;
    setup_custody_balance(&program, &sol_usdc_mint, custody_amount).await?;
    
    // 注册TokenBinding（Ethereum USDC → Solana USDC, 1:1）
    let eth_usdc = eth_usdc_address_bytes32();
    register_token_binding(
        &program,
        1, eth_usdc,  // Ethereum USDC
        2, sol_usdc_mint.to_bytes(),  // Solana USDC
        1, 1  // 1:1
    ).await?;
    
    // 构造来自Ethereum的转账VAA
    let payload = TokenTransferPayload {
        payload_type: 1,
        amount: 500_000_000,  // 源链500 USDC
        token_address: eth_usdc,
        token_chain: 1,  // Ethereum
        recipient: user.pubkey().to_bytes(),
        recipient_chain: 2,  // Solana
        // 新增兑换字段
        target_token: sol_usdc_mint.to_bytes(),
        target_amount: 500_000_000,  // 目标链500 USDC (1:1)
        exchange_rate_num: 1,
        exchange_rate_denom: 1,
    };
    
    let vaa = create_token_transfer_vaa(
        emitter_chain: 1,  // Ethereum
        payload: payload.serialize(),
        guardians: &test_guardians[0..13],
    );
    
    // 完成转账
    let tx = program.methods()
        .complete_transfer(vaa)
        .accounts({
            bridge: bridge_pda,
            posted_vaa: posted_vaa_pda,
            token_binding: token_binding_pda,
            recipient_account: user_token_account,
            custody_account: custody_pda,
            target_token_mint: sol_usdc_mint,
            token_program: token_program::ID,
        })
        .rpc()
        .await?;
    
    // 验证用户收到代币
    let user_account = get_token_account(&program, user_token_account).await?;
    assert_eq!(user_account.amount, 500_000_000);
    
    // 验证custody减少
    let custody = get_token_account(&program, custody_pda).await?;
    assert_eq!(custody.amount, 500_000_000);
    
    // 验证VAA标记为已消费
    let posted_vaa = program.account::<PostedVAA>(posted_vaa_pda).await?;
    assert_eq!(posted_vaa.consumed, true);
}
```

**测试示例 UNIT-TB-010: 跨链兑换不同代币接收**:
```rust
#[tokio::test]
async fn test_complete_transfer_different_token() {
    let program = setup_token_bridge_program().await;
    
    // Ethereum USDT → Solana USDC (1:1.002兑换，USDT稍便宜)
    let sol_usdc_mint = create_test_mint(&program, 6).await?;
    setup_custody_balance(&program, &sol_usdc_mint, 2000_000_000).await?;
    
    let eth_usdt = eth_usdt_address_bytes32();
    register_token_binding(
        &program,
        1, eth_usdt,  // Ethereum USDT
        2, sol_usdc_mint.to_bytes(),  // Solana USDC
        1002, 1000  // 1 USDT = 1.002 USDC
    ).await?;
    
    // VAA payload
    let payload = TokenTransferPayload {
        payload_type: 1,
        amount: 1000_000_000,  // 1000 USDT
        token_address: eth_usdt,
        token_chain: 1,
        recipient: user.pubkey().to_bytes(),
        recipient_chain: 2,
        target_token: sol_usdc_mint.to_bytes(),
        target_amount: 1_002_000_000,  // 1002 USDC
        exchange_rate_num: 1002,
        exchange_rate_denom: 1000,
    };
    
    let vaa = create_token_transfer_vaa(
        emitter_chain: 1,
        payload: payload.serialize(),
        guardians: &test_guardians[0..13],
    );
    
    // 完成转账
    let tx = program.methods()
        .complete_transfer(vaa)
        .accounts({ ... })
        .rpc()
        .await?;
    
    // 验证用户收到兑换后的代币
    let user_account = get_token_account(&program, user_token_account).await?;
    assert_eq!(user_account.amount, 1_002_000_000);  // 1002 USDC
}
```

**测试示例 UNIT-TB-025: 兑换比率验证失败**:
```rust
#[tokio::test]
async fn test_complete_transfer_invalid_exchange_rate() {
    let program = setup_token_bridge_program().await;
    
    // 注册1:1兑换比率
    register_token_binding(&program, 1, eth_usdc, 2, sol_usdc, 1, 1).await?;
    
    // VAA包含错误的兑换比率
    let payload = TokenTransferPayload {
        amount: 1000_000_000,
        target_amount: 1100_000_000,  // 错误：声称1:1.1
        exchange_rate_num: 11,  // 错误的比率
        exchange_rate_denom: 10,
        ...
    };
    
    let vaa = create_token_transfer_vaa(...);
    
    let result = program.methods()
        .complete_transfer(vaa)
        .accounts({ ... })
        .rpc()
        .await;
    
    assert!(result.is_err());
    assert_eq!(
        result.unwrap_err().to_string(),
        "Invalid exchange rate"
    );
}
```

---

#### 2.2.3 register_token_binding指令测试

| 测试ID | 测试场景 | 优先级 |
|-------|---------|--------|
| UNIT-TB-011 | 正常注册单向代币绑定 | P0 |
| UNIT-TB-012 | 重复注册失败 | P0 |
| UNIT-TB-013 | 非管理员调用失败 | P0 |
| UNIT-TB-014 | 注册不同代币兑换对（多对多） | P0 |
| UNIT-TB-030 | 注册出站和入站binding（双向） | P0 |

#### 2.2.4 register_bidirectional_binding指令测试

| 测试ID | 测试场景 | 优先级 |
|-------|---------|--------|
| UNIT-TB-031 | 双向注册同币种（1:1） | P0 |
| UNIT-TB-032 | 双向注册不同币种 | P0 |
| UNIT-TB-033 | 双向不对称兑换比率 | P0 |
| UNIT-TB-034 | 验证自动创建两个binding | P0 |
| UNIT-TB-035 | 非管理员调用失败 | P0 |

#### 2.2.5 set_exchange_rate指令测试

| 测试ID | 测试场景 | 优先级 |
|-------|---------|--------|
| UNIT-TB-015 | 设置1:1兑换比率 | P0 |
| UNIT-TB-016 | 设置自定义兑换比率 | P0 |
| UNIT-TB-017 | 分母为0失败 | P0 |
| UNIT-TB-018 | TokenBinding不存在失败 | P0 |
| UNIT-TB-019 | 非管理员调用失败 | P0 |

#### 2.2.6 update_amm_config指令测试

| 测试ID | 测试场景 | 优先级 |
|-------|---------|--------|
| UNIT-TB-020 | 启用外部AMM定价 | P1 |
| UNIT-TB-021 | 禁用外部AMM定价 | P1 |
| UNIT-TB-022 | 非管理员调用失败 | P1 |

---

**测试示例 UNIT-TB-011: 正常注册代币绑定**:
```rust
#[tokio::test]
async fn test_register_token_binding() {
    let program = setup_token_bridge_program().await;
    
    // Ethereum USDC地址
    let eth_usdc = [0xA0, 0xb8, 0x69, 0x91, ...];  // 32字节
    
    // Solana USDC Mint
    let sol_usdc = Pubkey::from_str("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v").unwrap();
    
    let tx = program.methods()
        .register_token_binding(
            1,  // source_chain: Ethereum
            eth_usdc,
            2,  // target_chain: Solana
            sol_usdc
        )
        .accounts({
            bridge_config: bridge_config_pda,
            token_binding: token_binding_pda,
            authority: authority.pubkey(),
            payer: payer.pubkey(),
            system_program: system_program::ID,
        })
        .signers([&authority, &payer])
        .rpc()
        .await?;
    
    // 验证TokenBinding账户
    let binding = program.account::<TokenBinding>(token_binding_pda).await?;
    assert_eq!(binding.source_chain, 1);
    assert_eq!(binding.source_token, eth_usdc);
    assert_eq!(binding.target_chain, 2);
    assert_eq!(binding.target_token, sol_usdc.to_bytes());
    assert_eq!(binding.rate_numerator, 1);  // 默认1:1
    assert_eq!(binding.rate_denominator, 1);
    assert_eq!(binding.enabled, true);
    assert_eq!(binding.use_external_price, false);
}
```

**测试示例 UNIT-TB-014: 注册不同代币兑换对（多对多）**:
```rust
#[tokio::test]
async fn test_register_multiple_target_tokens() {
    let program = setup_token_bridge_program().await;
    
    let sol_usdc = sol_usdc_address();
    let eth_usdc = eth_usdc_address();
    let eth_usdt = eth_usdt_address();
    let eth_dai = eth_dai_address();
    
    // 同一源代币注册多个目标代币
    // Solana USDC → Ethereum USDC
    register_token_binding(&program, 2, sol_usdc, 1, eth_usdc).await?;
    
    // Solana USDC → Ethereum USDT
    register_token_binding(&program, 2, sol_usdc, 1, eth_usdt).await?;
    
    // Solana USDC → Ethereum DAI
    register_token_binding(&program, 2, sol_usdc, 1, eth_dai).await?;
    
    // 验证所有binding都存在
    let binding_usdc = get_token_binding(&program, 2, sol_usdc, 1, eth_usdc).await?;
    assert_eq!(binding_usdc.target_token, eth_usdc);
    
    let binding_usdt = get_token_binding(&program, 2, sol_usdc, 1, eth_usdt).await?;
    assert_eq!(binding_usdt.target_token, eth_usdt);
    
    let binding_dai = get_token_binding(&program, 2, sol_usdc, 1, eth_dai).await?;
    assert_eq!(binding_dai.target_token, eth_dai);
}
```

**测试示例 UNIT-TB-030: 注册出站和入站binding（双向）**:
```rust
#[tokio::test]
async fn test_register_outbound_and_inbound_bindings() {
    let program = setup_token_bridge_program().await;
    
    // 在Solana链上注册双向binding
    // 1. 出站: Solana USDC → Ethereum USDC
    register_token_binding(&program, 2, sol_usdc, 1, eth_usdc).await?;
    
    // 2. 入站: Ethereum USDC → Solana USDC (用于验证)
    register_token_binding(&program, 1, eth_usdc, 2, sol_usdc).await?;
    
    // 验证出站binding
    let outbound = get_token_binding(&program, 2, sol_usdc, 1, eth_usdc).await?;
    assert_eq!(outbound.source_chain, 2);
    assert_eq!(outbound.target_chain, 1);
    
    // 验证入站binding
    let inbound = get_token_binding(&program, 1, eth_usdc, 2, sol_usdc).await?;
    assert_eq!(inbound.source_chain, 1);
    assert_eq!(inbound.target_chain, 2);
}
```

---

**测试示例 UNIT-TB-031: 双向注册同币种（1:1）**:
```rust
#[tokio::test]
async fn test_register_bidirectional_same_token() {
    let program = setup_token_bridge_program().await;
    
    let tx = program.methods()
        .register_bidirectional_binding(
            2, sol_usdc,      // local
            1, eth_usdc,      // remote
            1, 1,             // outbound rate 1:1
            1, 1,             // inbound rate 1:1
        )
        .accounts({
            bridge_config: bridge_config_pda,
            outbound_binding: outbound_pda,
            inbound_binding: inbound_pda,
            authority: authority.pubkey(),
            payer: payer.pubkey(),
            system_program: system_program::ID,
        })
        .signers([&authority, &payer])
        .rpc()
        .await?;
    
    // 验证出站binding
    let outbound = program.account::<TokenBinding>(outbound_pda).await?;
    assert_eq!(outbound.source_chain, 2);
    assert_eq!(outbound.source_token, sol_usdc);
    assert_eq!(outbound.target_chain, 1);
    assert_eq!(outbound.target_token, eth_usdc);
    assert_eq!(outbound.rate_numerator, 1);
    assert_eq!(outbound.rate_denominator, 1);
    
    // 验证入站binding
    let inbound = program.account::<TokenBinding>(inbound_pda).await?;
    assert_eq!(inbound.source_chain, 1);
    assert_eq!(inbound.source_token, eth_usdc);
    assert_eq!(inbound.target_chain, 2);
    assert_eq!(inbound.target_token, sol_usdc);
    assert_eq!(inbound.rate_numerator, 1);
    assert_eq!(inbound.rate_denominator, 1);
}
```

**测试示例 UNIT-TB-033: 双向不对称兑换比率**:
```rust
#[tokio::test]
async fn test_register_bidirectional_asymmetric_rates() {
    let program = setup_token_bridge_program().await;
    
    // 出站和入站使用不同的兑换比率（考虑手续费等）
    let tx = program.methods()
        .register_bidirectional_binding(
            2, sol_usdc,
            1, eth_usdt,
            998, 1000,  // 出站: 1 USDC = 0.998 USDT
            1002, 1000, // 入站: 1 USDT = 1.002 USDC (补偿)
        )
        .accounts({ ... })
        .rpc()
        .await?;
    
    let outbound = program.account::<TokenBinding>(outbound_pda).await?;
    assert_eq!(outbound.rate_numerator, 998);
    assert_eq!(outbound.rate_denominator, 1000);
    
    let inbound = program.account::<TokenBinding>(inbound_pda).await?;
    assert_eq!(inbound.rate_numerator, 1002);
    assert_eq!(inbound.rate_denominator, 1000);
    
    // 验证兑换计算
    let outbound_amount = 1000_000_000 * 998 / 1000;
    assert_eq!(outbound_amount, 998_000_000);  // 0.998
    
    let inbound_amount = 1000_000_000 * 1002 / 1000;
    assert_eq!(inbound_amount, 1_002_000_000);  // 1.002
}
```

**测试示例 UNIT-TB-015: 设置1:1兑换比率**:
```rust
#[tokio::test]
async fn test_set_exchange_rate_one_to_one() {
    let program = setup_token_bridge_program().await;
    
    // 先注册TokenBinding
    register_token_binding(&program, sol_usdc, eth_usdc).await?;
    
    // 设置兑换比率
    let tx = program.methods()
        .set_exchange_rate(
            2,  // Solana
            sol_usdc.to_bytes(),
            1,  // Ethereum
            1,  // rate_numerator
            1   // rate_denominator
        )
        .accounts({
            token_binding: token_binding_pda,
            authority: authority.pubkey(),
        })
        .signer(&authority)
        .rpc()
        .await?;
    
    let binding = program.account::<TokenBinding>(token_binding_pda).await?;
    assert_eq!(binding.rate_numerator, 1);
    assert_eq!(binding.rate_denominator, 1);
    
    // 验证兑换计算
    let source_amount = 1000_000_000u64;
    let target_amount = source_amount * binding.rate_numerator / binding.rate_denominator;
    assert_eq!(target_amount, 1000_000_000u64);  // 1:1
}
```

**测试示例 UNIT-TB-016: 设置自定义兑换比率**:
```rust
#[tokio::test]
async fn test_set_custom_exchange_rate() {
    let program = setup_token_bridge_program().await;
    
    // 设置 1 USDC = 0.998 USDT
    let tx = program.methods()
        .set_exchange_rate(
            2,    // Solana
            sol_usdc.to_bytes(),
            1,    // Ethereum
            998,  // rate_numerator
            1000  // rate_denominator
        )
        .accounts({ ... })
        .rpc()
        .await?;
    
    let binding = program.account::<TokenBinding>(token_binding_pda).await?;
    assert_eq!(binding.rate_numerator, 998);
    assert_eq!(binding.rate_denominator, 1000);
    
    // 验证兑换计算
    let source_amount = 1000_000_000u64;  // 1000 USDC
    let target_amount = source_amount * 998 / 1000;
    assert_eq!(target_amount, 998_000_000u64);  // 998 USDT
}
```

**测试示例 UNIT-TB-017: 分母为0失败**:
```rust
#[tokio::test]
async fn test_set_exchange_rate_zero_denominator() {
    let program = setup_token_bridge_program().await;
    
    let result = program.methods()
        .set_exchange_rate(2, sol_usdc.to_bytes(), 1, 1, 0)  // 分母=0
        .accounts({ ... })
        .rpc()
        .await;
    
    assert!(result.is_err());
    assert_eq!(
        result.unwrap_err().to_string(),
        "Exchange rate denominator cannot be zero"
    );
}
```

---

## 3. 程序集成测试

### 3.1 跨程序调用测试

| 测试ID | 测试场景 | 优先级 |
|-------|---------|--------|
| INT-SOL-001 | transfer_tokens → post_message | P0 |
| INT-SOL-002 | post_vaa → complete_transfer | P0 |
| INT-SOL-003 | 多步骤原子性 | P0 |

**测试示例 INT-SOL-001**:
```rust
#[tokio::test]
async fn test_transfer_posts_message() {
    let (core_program, token_program) = setup_both_programs().await;
    
    // 执行transfer_tokens
    let tx = token_program.methods()
        .transfer_tokens(1000_000_000, 1, eth_recipient)
        .accounts({ ... })
        .rpc()
        .await?;
    
    // 验证post_message被调用
    let sequence = core_program.account::<Sequence>(sequence_pda).await?;
    assert_eq!(sequence.sequence, 1);
    
    // 验证消息内容
    let message = core_program.account::<PostedMessage>(message_pda).await?;
    let payload = TokenTransferPayload::deserialize(&message.payload)?;
    assert_eq!(payload.amount, 1000_000_000);
    assert_eq!(payload.recipient_chain, 1);
}
```

---

### 3.2 Guardian Set升级测试

| 测试ID | 测试场景 | 优先级 |
|-------|---------|--------|
| INT-SOL-004 | 升级后旧Set仍可验证 | P0 |
| INT-SOL-005 | 升级后新Set可验证 | P0 |
| INT-SOL-006 | 过期后旧Set拒绝 | P0 |

**测试示例 INT-SOL-004**:
```rust
#[tokio::test]
async fn test_guardian_upgrade_transition() {
    let program = setup_initialized_program().await;
    
    // 1. 升级Guardian Set
    upgrade_guardian_set(&program, new_guardians).await?;
    
    // 2. 测试旧Set签名的VAA（过渡期内）
    let vaa_old = create_test_vaa(
        guardian_set_index: 0,  // 旧Set
        guardians: &old_guardians[0..13],
        ...
    );
    
    let result = program.methods()
        .post_vaa(vaa_old)
        .accounts({ ... })
        .rpc()
        .await;
    
    assert!(result.is_ok());  // 过渡期内旧Set有效
    
    // 3. 测试新Set签名的VAA
    let vaa_new = create_test_vaa(
        guardian_set_index: 1,  // 新Set
        guardians: &new_guardians[0..13],
        ...
    );
    
    let result = program.methods()
        .post_vaa(vaa_new)
        .accounts({ ... })
        .rpc()
        .await;
    
    assert!(result.is_ok());  // 新Set也有效
    
    // 4. 7天后测试旧Set（应失败）
    advance_time(7 * 86400 + 1).await;
    
    let vaa_old_expired = create_test_vaa(
        guardian_set_index: 0,
        guardians: &old_guardians[0..13],
        ...
    );
    
    let result = program.methods()
        .post_vaa(vaa_old_expired)
        .accounts({ ... })
        .rpc()
        .await;
    
    assert!(result.is_err());  // 旧Set已过期
    assert_eq!(result.unwrap_err().to_string(), "Guardian set expired");
}
```

---

## 4. 跨链E2E测试

### 4.1 Solana → Ethereum

| 测试ID | 测试场景 | 优先级 | 预计时间 |
|-------|---------|--------|---------|
| E2E-SOL-001 | SPL代币跨链到Ethereum | P0 | 2分钟 |
| E2E-SOL-002 | Ethereum解锁原生ERC20 | P0 | 1分钟 |

**测试示例 E2E-SOL-001**:
```typescript
// E2E测试脚本
describe("Solana to Ethereum Transfer", () => {
  it("should transfer SPL token and receive ERC20", async () => {
    // 1. Solana: 锁定SPL代币
    const tx = await tokenBridge.methods
      .transferTokens(
        new BN(1000_000_000),  // 1000 USDC
        1,                      // Target chain: Ethereum
        ethRecipient
      )
      .rpc();
    
    console.log("Solana TX:", tx);
    
    // 2. 等待Guardian签名
    const sequence = await getSequenceNumber(tx);
    const vaa = await pollGuardianForVAA({
      emitterChain: 2,
      emitterAddress: tokenBridgeProgramId,
      sequence: sequence,
    });
    
    assert(vaa.signatures.length >= 13);
    
    // 3. Relayer提交到Ethereum
    const ethTx = await ethBridgeCore.receiveMessage(vaa);
    await ethTx.wait();
    
    // 4. 验证Ethereum余额
    const balance = await ethUSDC.balanceOf(ethRecipient);
    expect(balance).to.equal(ethers.utils.parseUnits("1000", 6));
  });
});
```

---

### 4.2 Ethereum → Solana

| 测试ID | 测试场景 | 优先级 | 预计时间 |
|-------|---------|--------|---------|
| E2E-SOL-003 | ERC20跨链到Solana解锁绑定SPL | P0 | 2分钟 |

**测试示例 E2E-SOL-003**:
```typescript
describe("Ethereum to Solana Transfer", () => {
  it("should lock ERC20 and unlock bound SPL token", async () => {
    // 前提：已通过register_token_binding注册binding关系
    // [1, eth_usdc, 900, sol_usdc] 已在Ethereum和Solana两端注册
    
    // 1. Ethereum: 锁定ERC20
    const tx = await ethTokenVault.lockTokens(
      ethUSDC.address,
      ethers.utils.parseUnits("1000", 6),
      2,  // Target chain: Solana
      solanaRecipient
    );
    await tx.wait();
    
    // 2. 获取VAA
    const sequence = await extractSequence(tx);
    const vaa = await pollGuardianForVAA({
      emitterChain: 1,
      emitterAddress: ethTokenVault.address,
      sequence: sequence,
    });
    
    // 3. Solana: post_vaa
    const postVaaTx = await solanaCore.methods
      .postVaa(vaa)
      .rpc();
    
    // 4. Solana: complete_transfer (基于binding解锁已有SPL代币)
    const completeTx = await tokenBridge.methods
      .completeTransfer(vaa)
      .rpc();
    
    // 5. 验证Solana余额 (解锁的是原生SPL USDC，不是wrapped token)
    const account = await getAccount(
      connection,
      solanaRecipientTokenAccount
    );
    expect(account.amount).to.equal(1000_000_000n);
  });
});
```

---

### 4.3 Guardian升级跨链测试

| 测试ID | 测试场景 | 优先级 | 预计时间 |
|-------|---------|--------|---------|
| E2E-SOL-005 | Solana Guardian升级原子性 | P0 | 5分钟 |

**测试流程**:
```
1. 在Ethereum升级Guardian Set
2. 等待VAA生成
3. 在Solana提交升级VAA
4. 验证两条链Guardian Set同步
5. 测试过渡期内跨链消息
6. 验证新旧Set都能工作
```

---

### 4.4 完整跨链流程测试

| 测试ID | 测试场景 | 优先级 | 预计时间 |
|-------|---------|--------|---------|
| E2E-SOL-006 | 完整往返测试 (Solana→Ethereum→Solana) | P1 | 5分钟 |
| E2E-SOL-007 | 多用户并发跨链测试 | P1 | 3分钟 |
| E2E-SOL-008 | 压力测试 - 大额转账 | P2 | 2分钟 |

**测试示例 E2E-SOL-006**:
```typescript
describe("完整往返测试", () => {
  it("should complete round trip: Solana→Ethereum→Solana", async () => {
    // 1. Solana: 锁定1000 USDC发往Ethereum
    await tokenBridge.methods
      .transferTokens(
        new BN(1000_000_000),
        ETH_CHAIN_ID,
        ethUsdcAddress,
        ethRecipient
      )
      .rpc();
    
    // 2. 验证Solana代币已锁定
    const custodyBalance1 = await getTokenBalance(connection, custodyAccount);
    expect(custodyBalance1).to.equal(1000_000_000n);
    
    // 3. 模拟Ethereum解锁并返回500 USDC到Solana
    const returnVaa = createTokenTransferVAA({
      emitterChain: ETH_CHAIN_ID,
      transferPayload: {
        amount: BigInt(500_000_000),
        tokenAddress: ethUsdcAddress,
        recipient: alicePublicKey.toBuffer(),
        targetToken: solUsdcMint.toBuffer(),
        // ...
      }
    });
    
    // 4. Solana: 接收返回的代币
    await coreProgram.methods.postVaa(returnVaa).rpc();
    await tokenBridge.methods.completeTransfer(returnVaa).rpc();
    
    // 5. 验证Alice收到500 USDC
    const aliceBalance = await getTokenBalance(connection, aliceTokenAccount);
    expect(aliceBalance).to.equal(500_000_000n);
  });
});
```

**测试示例 E2E-SOL-007**:
```typescript
describe("多用户并发测试", () => {
  it("should handle concurrent transfers from multiple users", async () => {
    // 1. 创建3个用户，每人5000 USDC
    const users = [];
    for (let i = 0; i < 3; i++) {
      const user = Keypair.generate();
      const userAccount = await createAndMintTestToken(
        connection, payer, solUsdcMint, user.publicKey,
        BigInt(5000_000_000)
      );
      users.push({ keypair: user, account: userAccount });
    }
    
    // 2. 所有用户并发发起跨链转账
    const transfers = users.map((user, i) => 
      tokenBridge.methods
        .transferTokens(
          new BN(1000_000_000),
          ETH_CHAIN_ID,
          ethUsdcAddress,
          ethRecipient
        )
        .accounts({
          tokenAccount: user.account,
          tokenAuthority: user.keypair.publicKey,
          // ...
        })
        .signers([user.keypair])
        .rpc()
    );
    
    await Promise.all(transfers);
    
    // 3. 验证所有转账成功
    const custodyBalance = await getTokenBalance(connection, custodyAccount);
    expect(custodyBalance).to.equal(3000_000_000n);
  });
});
```

**测试示例 E2E-SOL-008**:
```typescript
describe("大额转账压力测试", () => {
  it("should handle large amount transfer", async () => {
    // 1. 创建巨鲸账户，持有1,000,000 USDC
    const whaleAccount = await createAndMintTestToken(
      connection, payer, solUsdcMint, alice.publicKey,
      BigInt(1_000_000_000_000)
    );
    
    // 2. 转账100,000 USDC
    const largeAmount = new BN(100_000_000_000);
    
    await tokenBridge.methods
      .transferTokens(
        largeAmount,
        ETH_CHAIN_ID,
        ethUsdcAddress,
        ethRecipient
      )
      .rpc();
    
    // 3. 验证转账成功
    const custodyBalance = await getTokenBalance(connection, custodyAccount);
    expect(custodyBalance).to.equal(100_000_000_000n);
    
    // 4. 验证余额计算正确（无溢出）
    const whaleBalance = await getTokenBalance(connection, whaleAccount);
    expect(whaleBalance).to.equal(900_000_000_000n);
  });
});
```

---

## 5. 测试环境配置

### 5.1 本地测试环境

#### Anchor.toml配置
```toml
[features]
seeds = false
skip-lint = false

[programs.localnet]
solana_core = "worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth"
token_bridge = "wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb"

[scripts]
test = "yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts"

[test]
startup_wait = 5000

[[test.validator.clone]]
address = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"

[[test.validator.clone]]
address = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
```

---

### 5.2 测试工具函数

```typescript
// tests/utils/helpers.ts

/**
 * 创建测试VAA
 */
export function createTestVAA(params: {
  guardianSetIndex: number;
  emitterChain: number;
  emitterAddress: string;
  sequence: number;
  payload: Buffer;
  guardians: Keypair[];
}): Buffer {
  // VAA构造逻辑
  const header = Buffer.alloc(6);
  header.writeUInt8(1, 0);  // version
  header.writeUInt32BE(params.guardianSetIndex, 1);
  header.writeUInt8(params.guardians.length, 5);
  
  // 签名部分
  const bodyHash = keccak256(encodeBody(params));
  const signatures = params.guardians.map((guardian, index) => {
    const sig = guardian.sign(bodyHash);
    return Buffer.concat([
      Buffer.from([index]),
      sig
    ]);
  });
  
  return Buffer.concat([header, ...signatures, encodeBody(params)]);
}

/**
 * 从Guardian API轮询VAA
 */
export async function pollGuardianForVAA(
  messageId: {
    emitterChain: number;
    emitterAddress: string;
    sequence: number;
  },
  timeout: number = 60000
): Promise<Buffer> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(
        `http://localhost:7071/v1/signed_vaa/${messageId.emitterChain}/${messageId.emitterAddress}/${messageId.sequence}`
      );
      
      if (response.status === 200) {
        const data = await response.json();
        return Buffer.from(data.vaaBytes.slice(2), 'hex');
      }
      
      if (response.status === 404) {
        throw new Error("VAA not found");
      }
      
      // 202: 聚合中，继续等待
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (err) {
      console.log("Polling VAA...", err.message);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  throw new Error("VAA timeout");
}
```

---

### 5.3 CI/CD配置

```yaml
# .github/workflows/solana-test.yml
name: Solana Contract Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Install Solana
        run: |
          sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
          echo "$HOME/.local/share/solana/install/active_release/bin" >> $GITHUB_PATH
      
      - name: Install Anchor
        run: |
          cargo install --git https://github.com/coral-xyz/anchor anchor-cli --locked
      
      - name: Run Anchor tests
        working-directory: contracts/svm
        run: |
          anchor test
      
      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: test-results
          path: contracts/svm/test-results/
```

---

## 附录

### A. 测试实现说明

#### A.1 真实密码学实现

测试套件使用**真实的密码学算法**，而不是模拟数据：

**Guardian密钥生成（secp256k1）**:
```typescript
// 使用elliptic库生成真实的secp256k1密钥对
import { ec as EC } from "elliptic";
const ec = new EC("secp256k1");

export function generateGuardianKey(seed?: Buffer): GuardianKeyPair {
  const privateKey = seed || crypto.randomBytes(32);
  const key = ec.keyFromPrivate(privateKey);
  
  // 计算Ethereum兼容的20字节地址
  const publicKey = Buffer.concat([
    Buffer.from(key.getX().toArray('be', 32)),
    Buffer.from(key.getY().toArray('be', 32))
  ]);
  const publicKeyHash = Buffer.from(keccak256(publicKey), 'hex');
  const address = publicKeyHash.slice(-20);
  
  return { privateKey, publicKey, address };
}

// 生成19个Guardian密钥
export const TEST_GUARDIAN_KEYS = generateGuardianKeys(19);
```

**ECDSA签名**:
```typescript
export function signVAA(bodyHash: Buffer, guardianKey: GuardianKeyPair, guardianIndex: number) {
  const key = ec.keyFromPrivate(guardianKey.privateKey);
  const signature = key.sign(bodyHash, { canonical: true });
  
  return {
    guardianIndex,
    r: Buffer.from(signature.r.toArray('be', 32)),
    s: Buffer.from(signature.s.toArray('be', 32)),
    v: signature.recoveryParam!,
  };
}
```

**签名验证**:
```typescript
export function verifyVAASignature(bodyHash: Buffer, signature: Signature, guardianAddress: Buffer) {
  const key = ec.recoverPubKey(bodyHash, { r: signature.r, s: signature.s }, signature.v);
  const publicKey = Buffer.concat([...]);
  const recoveredAddress = Buffer.from(keccak256(publicKey), 'hex').slice(-20);
  return recoveredAddress.equals(guardianAddress);
}
```

#### A.2 VAA构造

**完整VAA构造流程**:
```typescript
export function createTokenTransferVAA(params: {
  guardianSetIndex: number;
  emitterChain: number;
  emitterAddress: Buffer;
  sequence: bigint;
  guardianKeys: GuardianKeyPair[];  // 真实的secp256k1密钥
  transferPayload: TokenTransferPayload;
  signerCount?: number;  // 默认13
}): Buffer {
  // 1. 序列化Payload
  const payload = serializeTokenTransferPayload(params.transferPayload);
  
  // 2. 序列化Body
  const bodyBuffer = serializeVAABody({ timestamp, nonce, emitterChain, ... });
  
  // 3. 计算双重哈希
  const bodyHash = keccak256(bodyBuffer);
  const doubleHash = keccak256(bodyHash);
  
  // 4. 生成真实签名（13个Guardian）
  const signatures = [];
  for (let i = 0; i < 13; i++) {
    signatures.push(signVAA(doubleHash, guardianKeys[i], i));
  }
  
  // 5. 序列化完整VAA
  return serializeVAA({ version: 1, guardianSetIndex, signatures, ... });
}
```

#### A.3 测试运行

```bash
# 运行密码学演示测试
cd contracts/svm/bridge-programs
ts-mocha -p ./tsconfig.json tests/demo-crypto.test.ts

# 输出示例：
# ✓ 生成19个Guardian密钥
#   Guardian 0: 0x8c8c3c3d9e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e
# ✓ ECDSA签名和验证: ✓ 通过
# ✓ VAA构造完成: 1122 bytes, 13/13签名验证通过
```

#### A.4 测试覆盖

| 功能 | 实现方式 | 状态 |
|------|---------|------|
| secp256k1密钥生成 | `elliptic`库 | ✅ 真实实现 |
| ECDSA签名 | `elliptic.sign()` | ✅ 真实实现 |
| 签名验证 | `elliptic.recoverPubKey()` | ✅ 真实实现 |
| Keccak256哈希 | `js-sha3` | ✅ 真实实现 |
| VAA序列化 | 符合Wormhole协议 | ✅ 完整实现 |
| TokenTransfer Payload | 133字节格式 | ✅ 完整实现 |
| GuardianSetUpgrade Payload | 可变长度格式 | ✅ 完整实现 |

---

### B. 覆盖率报告

使用 `anchor-coverage` 工具生成覆盖率报告：

```bash
cd contracts/svm
anchor test --skip-deploy
anchor coverage
```

**目标覆盖率**:
- 指令覆盖率: 100%
- 分支覆盖率: 90%
- 行覆盖率: 90%

---

**文档状态**: ✅ v1.0 初版完成  
**维护者**: Solana合约测试团队

