# EVM合约子模块 - 测试套件规划

> **文档版本**: v2.0  
> **创建日期**: 2025-11-09  
> **最后更新**: 2025-11-10  
> **子模块**: EVM智能合约  
> **测试目标**: 验证EVM与SVM双向桥接

---

## 📋 目录

1. [测试策略](#1-测试策略)
2. [单元测试规划](#2-单元测试规划)
3. [集成测试规划](#3-集成测试规划)
4. [跨链桥接测试](#4-跨链桥接测试)
5. [测试环境配置](#5-测试环境配置)
6. [测试数据准备](#6-测试数据准备)

---

## 1. 测试策略

### 1.1 测试分层

```
┌──────────────────────────────────────────┐
│  跨链桥接测试                             │  20%
│  - EVM → SVM 完整流程                    │
│  - SVM → EVM 完整流程                    │
│  - 往返测试                              │
└──────────────────────────────────────────┘
                 ↓
┌──────────────────────────────────────────┐
│  集成测试                                 │  25%
│  - 合约间交互                             │
│  - VAA生成和验证                         │
│  - TokenBinding验证                      │
└──────────────────────────────────────────┘
                 ↓
┌──────────────────────────────────────────┐
│  单元测试                                 │  55%
│  - BridgeCore函数                        │
│  - TokenVault函数                        │
│  - 管理功能                              │
└──────────────────────────────────────────┘
```

---

### 1.2 与SVM对比

| 测试类型 | SVM实际 | EVM计划 | 说明 |
|---------|---------|---------|------|
| **单元测试** | 53个 (87%) | 50个 | 功能对等 |
| **集成测试** | 6个 (50%) | 10个 | 增加跨链场景 |
| **跨链测试** | 8个 (63%) | 12个 | EVM↔SVM双向 |
| **总计** | 67个 (86%) | **72个** | 确保双向桥接 |

**关键差异**:
- ✅ **移除**: SVM特有的三步骤VAA测试（init_buffer, append_chunk）
- ✅ **简化**: 序列号管理测试（EVM自动处理）
- ✅ **新增**: 跨链桥接测试（验证EVM↔SVM互操作）

---

### 1.3 测试覆盖目标

| 测试类型 | 覆盖率目标 | 用例数 | 预计时间 |
|---------|-----------|--------|---------|
| **BridgeCore单元** | 95%代码 | 20个 | 10分钟 |
| **TokenVault单元** | 95%代码 | 30个 | 15分钟 |
| **集成测试** | 90%场景 | 10个 | 10分钟 |
| **跨链桥接** | 100%关键路径 | 12个 | 20分钟 |
| **总计** | - | **72个** | **55分钟** |

---

### 1.4 测试优先级

| 优先级 | 测试内容 | 说明 |
|-------|---------|------|
| **P0** | VAA验证、EVM↔SVM双向桥接、防重放 | 核心功能，必须通过 |
| **P1** | TokenBinding验证、兑换比率验证 | 重要功能 |
| **P2** | 速率限制、权限控制、错误处理 | 辅助功能 |
| **P3** | Gas优化、边界条件 | 性能优化 |

---

### 1.5 测试环境

**本地环境**:
- Foundry本地链（Chain ID: 65520）
- Solana Test Validator（Chain ID: 901）
- Guardian模拟（19个测试密钥）

**测试网环境**:
- Sepolia（Chain ID: 11155111）
- Solana Devnet（Chain ID: 901）
- 真实Guardian网络

---

## 2. 单元测试规划

### 2.1 BridgeCore.sol测试

#### 2.1.1 publishMessage函数测试

| 测试ID | 测试场景 | 预期结果 | 优先级 |
|-------|---------|---------|--------|
| CORE-001 | 正常发布消息 | 返回序列号，发出事件 | P0 |
| CORE-002 | 手续费不足 | revert InsufficientFee | P0 |
| CORE-003 | 序列号递增 | 每次调用递增1 | P0 |
| CORE-004 | 合约暂停时发布 | revert BridgePaused | P0 |
| CORE-005 | 空payload | 正常执行 | P1 |
| CORE-006 | 大payload（32KB） | 正常执行 | P1 |
| CORE-007 | 不同consistencyLevel | 正确存储 | P1 |

**测试代码示例**:
```solidity
function testPublishMessage() public {
    bytes memory payload = hex"010203";
    uint256 fee = bridgeCore.messageFee();
    
    vm.expectEmit(true, true, true, true);
    emit LogMessagePublished(
        address(this),
        0,  // sequence
        123,  // nonce
        payload,
        200  // consistencyLevel
    );
    
    uint64 seq = bridgeCore.publishMessage{value: fee}(
        123,
        payload,
        200
    );
    
    assertEq(seq, 0);
}

function testPublishMessage_InsufficientFee() public {
    bytes memory payload = hex"010203";
    
    vm.expectRevert(InsufficientFee.selector);
    bridgeCore.publishMessage{value: 0}(123, payload, 200);
}
```

---

#### 2.1.2 VAA解析与验证测试

| 测试ID | 测试场景 | 预期结果 | 优先级 |
|-------|---------|---------|--------|
| CORE-008 | 有效VAA解析 | 正确解析所有字段 | P0 |
| CORE-009 | 无效VAA格式 | revert InvalidVAA | P0 |
| CORE-010 | 签名数量不足（12个） | revert InsufficientSignatures | P0 |
| CORE-011 | 签名数量达到门限（13个） | 验证通过 | P0 |
| CORE-012 | 签名数量超过门限（15个） | 验证通过 | P0 |
| CORE-013 | 无效签名 | revert InvalidSignature | P0 |
| CORE-014 | Guardian Set不匹配 | revert InvalidGuardianSet | P0 |
| CORE-015 | 过期的Guardian Set | revert InvalidGuardianSet | P0 |

**测试代码示例**:
```solidity
function testReceiveMessage_ValidVAA() public {
    // 构造有效VAA（13个签名）
    bytes memory vaa = buildValidVAA(
        guardianSet0,
        13,  // 13个签名
        payload
    );
    
    bool success = bridgeCore.receiveMessage(vaa);
    
    assertTrue(success);
    bytes32 vaaHash = keccak256(vaa);
    assertTrue(bridgeCore.isVAAConsumed(vaaHash));
}

function testReceiveMessage_InsufficientSignatures() public {
    // 构造VAA（只有12个签名）
    bytes memory vaa = buildValidVAA(
        guardianSet0,
        12,  // 不足门限
        payload
    );
    
    vm.expectRevert(InsufficientSignatures.selector);
    bridgeCore.receiveMessage(vaa);
}
```

---

#### 2.1.3 防重放测试

| 测试ID | 测试场景 | 预期结果 | 优先级 |
|-------|---------|---------|--------|
| CORE-016 | 首次提交VAA | 成功 | P0 |
| CORE-017 | 重复提交相同VAA | revert VAAAlreadyConsumed | P0 |
| CORE-018 | 查询未消费VAA | 返回false | P0 |
| CORE-019 | 查询已消费VAA | 返回true | P0 |

---

#### 2.1.4 Guardian Set管理测试

| 测试ID | 测试场景 | 预期结果 | 优先级 |
|-------|---------|---------|--------|
| CORE-020 | 升级Guardian Set | 新Set激活，旧Set设置过期时间 | P0 |
| CORE-021 | 查询当前Guardian Set | 返回正确索引 | P0 |
| CORE-022 | 过渡期使用旧Set签名 | 验证通过 | P0 |
| CORE-023 | 过渡期使用新Set签名 | 验证通过 | P0 |
| CORE-024 | 过期后使用旧Set | revert InvalidGuardianSet | P0 |
| CORE-025 | 未授权升级 | revert（通过VAA验证） | P0 |

---

### 2.2 TokenVault.sol测试

#### 2.2.1 lockTokens函数测试

| 测试ID | 测试场景 | 预期结果 | 优先级 |
|-------|---------|---------|--------|
| VAULT-001 | 正常锁定ERC20 | 代币转入Vault，发出事件 | P0 |
| VAULT-002 | 授权不足 | revert (ERC20: insufficient allowance) | P0 |
| VAULT-003 | 余额不足 | revert (ERC20: transfer amount exceeds balance) | P0 |
| VAULT-004 | 超出单笔限额 | revert ExceedsRateLimit | P0 |
| VAULT-005 | 超出每日限额 | revert ExceedsRateLimit | P0 |
| VAULT-006 | 手续费不足 | revert InsufficientFee | P0 |
| VAULT-007 | 无效目标链ID | revert InvalidChainId | P0 |
| VAULT-008 | 合约暂停时锁定 | revert BridgePaused | P0 |
| VAULT-009 | 零金额转账 | revert或正常（根据设计） | P1 |
| VAULT-010 | 非常大金额（uint256.max） | 按限额检查 | P1 |

**测试代码示例**:
```solidity
function testLockTokens_Success() public {
    uint256 amount = 1000e6;  // 1000 USDC
    
    // 授权
    usdc.approve(address(vault), amount);
    
    // 记录初始余额
    uint256 userBalanceBefore = usdc.balanceOf(user);
    uint256 vaultBalanceBefore = usdc.balanceOf(address(vault));
    
    // 锁定代币
    vm.expectEmit(true, true, true, true);
    emit TokensLocked(
        transferId,
        address(usdc),
        user,
        amount,
        2,  // Solana
        recipientBytes32
    );
    
    bytes32 transferId = vault.lockTokens{value: 0.001 ether}(
        address(usdc),
        amount,
        2,  // target chain: Solana
        recipientBytes32
    );
    
    // 验证余额变化
    assertEq(usdc.balanceOf(user), userBalanceBefore - amount);
    assertEq(usdc.balanceOf(address(vault)), vaultBalanceBefore + amount);
}

function testLockTokens_ExceedsRateLimit() public {
    uint256 amount = 2_000_000e6;  // 2M USDC，超过单笔限额
    
    usdc.approve(address(vault), amount);
    
    vm.expectRevert(ExceedsRateLimit.selector);
    vault.lockTokens{value: 0.001 ether}(
        address(usdc),
        amount,
        2,
        recipientBytes32
    );
}
```

---

#### 2.2.2 unlockTokens函数测试

| 测试ID | 测试场景 | 预期结果 | 优先级 |
|-------|---------|---------|--------|
| VAULT-011 | 正常解锁代币 | 代币转给接收者 | P0 |
| VAULT-012 | VAA无效 | revert InvalidVAA | P0 |
| VAULT-013 | VAA已消费 | revert VAAAlreadyConsumed | P0 |
| VAULT-014 | Vault余额不足 | revert InsufficientBalance | P0 |
| VAULT-015 | 错误的代币地址 | revert InvalidToken | P0 |
| VAULT-016 | 合约暂停时解锁 | revert BridgePaused | P0 |

---

#### 2.2.3 速率限制测试

| 测试ID | 测试场景 | 预期结果 | 优先级 |
|-------|---------|---------|--------|
| VAULT-022 | 单笔限额边界值 | 正好等于限额时成功 | P0 |
| VAULT-023 | 单笔限额+1 | revert ExceedsRateLimit | P0 |
| VAULT-024 | 累计到每日限额 | 最后一笔成功 | P0 |
| VAULT-025 | 超过每日限额 | revert ExceedsRateLimit | P0 |
| VAULT-026 | 24小时后重置 | 限额重置，可再次转账 | P0 |
| VAULT-027 | 更新速率限制 | 新限额生效 | P1 |

---

### 2.3 管理功能测试

| 测试ID | 测试场景 | 预期结果 | 优先级 |
|-------|---------|---------|--------|
| ADMIN-001 | Governance暂停合约 | 合约暂停 | P0 |
| ADMIN-002 | 非Governance暂停 | revert Unauthorized | P0 |
| ADMIN-003 | Governance恢复合约 | 合约恢复 | P0 |
| ADMIN-004 | 设置速率限制 | 新限额生效 | P0 |
| ADMIN-005 | 非Governance设置限额 | revert Unauthorized | P0 |
| ADMIN-006 | 提取手续费 | 成功提取 | P0 |
| ADMIN-007 | 非Governance提取 | revert Unauthorized | P0 |
| ADMIN-008 | 提取超过余额 | revert InsufficientBalance | P0 |

---

## 3. 集成测试规划

### 3.1 BridgeCore与TokenVault集成

| 测试ID | 测试场景 | 验证点 | 优先级 |
|-------|---------|--------|--------|
| INT-EVM-001 | lockTokens → publishMessage | CPI调用、序列号递增 | P0 |
| INT-EVM-002 | receiveMessage → unlockTokens | VAA验证、代币解锁 | P0 |
| INT-EVM-003 | 多步骤原子性 | 失败回滚、状态一致 | P0 |
| INT-EVM-004 | Guardian Set升级 | 新旧Set并存 | P1 |
| INT-EVM-005 | TokenBinding验证流程 | 查询、验证、执行 | P0 |

### 3.2 TokenBinding管理测试

| 测试ID | 测试场景 | 验证点 | 优先级 |
|-------|---------|--------|--------|
| INT-EVM-006 | 注册双向TokenBinding | 出站+入站绑定 | P0 |
| INT-EVM-007 | 更新兑换比率 | 比率一致性验证 | P0 |
| INT-EVM-008 | 禁用TokenBinding | 阻止跨链交易 | P1 |
| INT-EVM-009 | 多对多TokenBinding | 一个源币多目标 | P1 |
| INT-EVM-010 | 跨币种兑换验证 | USDC→USDT计算 | P0 |

---

## 4. 跨链桥接测试（核心）

### 4.1 EVM → SVM 桥接测试

**测试目标**: 验证从Ethereum/Foundry到Solana的完整跨链流程

| 测试ID | 测试场景 | 流程 | 状态 |
|-------|---------|------|------|
| **BRIDGE-001** | Ethereum → Solana USDC (1:1) | 锁定→VAA→解锁 | P0 必须 |
| **BRIDGE-002** | Ethereum USDC → Solana USDT | 锁定→兑换→解锁 | P0 必须 |
| **BRIDGE-003** | 大额转账（100k USDC） | 锁定→VAA→解锁 | P1 重要 |
| **BRIDGE-004** | 多用户并发（3用户） | 并发锁定→解锁 | P1 重要 |

**BRIDGE-001详细步骤**:
```solidity
// 步骤1: Ethereum端锁定代币
Test setUp() {
    // 部署EVM合约（Foundry本地链，Chain ID: 65520）
    bridgeCore = new BridgeCore();
    vault = new TokenVault(address(bridgeCore));
    usdc = new MockERC20("USDC", "USDC", 6);
    
    // 初始化Guardian Set（19个测试密钥）
    bridgeCore.initialize(0, testGuardians, 0.001 ether);
    
    // 注册双向TokenBinding
    vault.registerBidirectionalBinding(
        65520,                          // Foundry
        toBytes32(address(usdc)),
        901,                            // Solana Devnet
        solanaUSDCBytes32,
        1, 1,  // 1:1 rate
        1, 1
    );
}

function testBridge_ETH_to_Solana_USDC() public {
    // 1. 用户在Ethereum锁定1000 USDC
    usdc.mint(alice, 1000e6);
    vm.startPrank(alice);
    usdc.approve(address(vault), 1000e6);
    
    uint64 seq = vault.lockTokens{value: 0.001 ether}(
        address(usdc),
        1000e6,
        901,                            // Solana Devnet
        solanaUSDCBytes32,
        alicesolanaAddress
    );
    vm.stopPrank();
    
    // 验证：代币已锁定
    assertEq(usdc.balanceOf(address(vault)), 1000e6);
    assertEq(usdc.balanceOf(alice), 0);
    
    // 2. 模拟Guardian签名VAA
    bytes memory vaa = buildVAAWithGuardianSignatures(
        seq,
        buildTokenTransferPayload(
            1000e6,
            address(usdc),
            65520,
            alicesolanaAddress,
            901,
            solanaUSDCBytes32,
            1000e6,  // targetAmount
            1, 1     // rate
        )
    );
    
    // 3. 调用Solana合约验证
    // 注：这里需要跨链调用真实Solana Test Validator
    // 或使用Solana程序模拟器
    (bool success) = callSolanaCompleteTransfer(vaa);
    assertTrue(success);
    
    // 4. 验证：Alice在Solana收到1000 USDC
    // 注：需要查询Solana链上余额
    uint64 solanaBalance = querySolanaTokenBalance(
        alicesolanaAddress,
        solanaUSDCBytes32
    );
    assertEq(solanaBalance, 1000e6);
}
```

---

### 4.2 SVM → EVM 桥接测试

**测试目标**: 验证从Solana到Ethereum/Foundry的完整跨链流程

| 测试ID | 测试场景 | 流程 | 状态 |
|-------|---------|------|------|
| **BRIDGE-005** | Solana → Ethereum USDC (1:1) | 锁定→VAA→解锁 | P0 必须 |
| **BRIDGE-006** | Solana USDC → Ethereum USDT | 锁定→兑换→解锁 | P0 必须 |
| **BRIDGE-007** | Guardian签名验证 | 13/19签名验证 | P0 必须 |
| **BRIDGE-008** | VAA防重放 | 重复提交失败 | P0 必须 |

**BRIDGE-005详细步骤**:
```solidity
function testBridge_Solana_to_ETH_USDC() public {
    // 1. 在Solana端锁定代币
    // 注：需要调用真实Solana程序或模拟器
    uint64 solanaSeq = callSolanaTransferTokens(
        aliceSolanaKeypair,
        solanaUSDCMint,
        1000e6,
        65520,  // Foundry
        toBytes32(address(usdc)),
        aliceEthAddress
    );
    
    // 2. 等待Guardian签名（模拟）
    bytes memory vaa = waitForGuardianVAA(901, solanaSeq);
    
    // 验证VAA格式
    assertEq(vaa.length, 1072);  // 13签名VAA
    
    // 3. 在Ethereum端解锁代币
    // 预先存入Custody余额
    usdc.mint(address(vault), 10000e6);
    
    bool success = vault.unlockTokens(vaa);
    assertTrue(success);
    
    // 4. 验证：Alice在Ethereum收到1000 USDC
    assertEq(usdc.balanceOf(alice), 1000e6);
    
    // 5. 验证：VAA已消费
    bytes32 vaaHash = keccak256(vaa);
    assertTrue(bridgeCore.isVAAConsumed(vaaHash));
    
    // 6. 验证：重复提交失败
    vm.expectRevert("VAAAlreadyConsumed");
    vault.unlockTokens(vaa);
}
```

---

### 4.3 往返测试

| 测试ID | 测试场景 | 流程 | 状态 |
|-------|---------|------|------|
| **BRIDGE-009** | 完整往返（ETH→SOL→ETH） | 双向完整流程 | P0 必须 |
| **BRIDGE-010** | 跨币种往返 | USDC→USDT→USDC | P1 重要 |
| **BRIDGE-011** | 多次往返 | 3次往返循环 | P2 可选 |
| **BRIDGE-012** | 并发往返 | 3用户同时往返 | P2 可选 |

**BRIDGE-009详细步骤**:
```solidity
function testBridge_RoundTrip() public {
    uint256 initialBalance = 1000e6;
    usdc.mint(alice, initialBalance);
    
    // === 第一段：Ethereum → Solana ===
    vm.startPrank(alice);
    usdc.approve(address(vault), initialBalance);
    uint64 seq1 = vault.lockTokens{value: 0.001 ether}(
        address(usdc),
        initialBalance,
        901,
        solanaUSDCBytes32,
        aliceSolanaAddress
    );
    vm.stopPrank();
    
    // Guardian签名 + Solana接收
    bytes memory vaa1 = buildAndSignVAA(seq1, ...);
    callSolanaCompleteTransfer(vaa1);
    
    // 验证：Alice在Solana有1000 USDC
    assertEq(querySolanaBalance(...), initialBalance);
    
    // === 第二段：Solana → Ethereum ===
    // Alice在Solana发起回传
    uint64 seq2 = callSolanaTransferTokens(
        aliceSolanaKeypair,
        solanaUSDCMint,
        initialBalance,
        65520,  // 回到Foundry
        toBytes32(address(usdc)),
        aliceEthAddress
    );
    
    // Guardian签名 + Ethereum接收
    bytes memory vaa2 = waitForGuardianVAA(901, seq2);
    usdc.mint(address(vault), initialBalance);  // 预存Custody
    vault.unlockTokens(vaa2);
    
    // 验证：Alice在Ethereum恢复初始余额
    assertEq(usdc.balanceOf(alice), initialBalance);
    
    // 验证：往返成功，无损失（1:1比率）
    assertTrue(true, "Round trip successful");
}
```

---

### 4.4 异常场景测试

| 测试ID | 测试场景 | 预期结果 | 优先级 |
|-------|---------|---------|--------|
| BRIDGE-ERR-001 | 无效Guardian签名 | revert InvalidSignature | P0 |
| BRIDGE-ERR-002 | 签名数量不足（12个） | revert InsufficientSignatures | P0 |
| BRIDGE-ERR-003 | 错误的目标链 | revert WrongChain | P0 |
| BRIDGE-ERR-004 | TokenBinding不存在 | revert TokenBindingNotFound | P0 |
| BRIDGE-ERR-005 | 兑换比率不匹配 | revert ExchangeRateMismatch | P0 |
| BRIDGE-ERR-006 | Custody余额不足 | revert InsufficientCustody | P0 |

---

### 4.5 测试工具支持

**需要的测试工具**:
1. **VAA Builder**: 构造和签名VAA（19个Guardian密钥）
2. **Solana模拟器**: 模拟Solana程序调用
3. **Guardian模拟器**: 模拟Guardian签名过程
4. **跨链工具**: 协调EVM↔SVM交互

**实现方式**:
```solidity
// test/utils/CrossChainHelper.sol
contract CrossChainHelper {
    // 构造EVM→SVM的VAA
    function buildVAAForSolana(...) external returns (bytes memory);
    
    // 构造SVM→EVM的VAA  
    function buildVAAForEthereum(...) external returns (bytes memory);
    
    // 模拟Guardian签名（13/19）
    function signWithGuardians(...) external returns (bytes memory);
    
    // 调用Solana程序（通过RPC或模拟器）
    function callSolanaProgram(...) external returns (bool);
    
    // 查询Solana状态
    function querySolanaState(...) external view returns (bytes memory);
}
```

**测试代码示例**:
```solidity
function testIntegration_FullCrossChainFlow() public {
    // 步骤1: 在源链锁定代币
    uint256 amount = 1000e6;
    usdc.approve(address(vault), amount);
    
    bytes32 transferId = vault.lockTokens{value: 0.001 ether}(
        address(usdc),
        amount,
        2,  // Solana
        recipientBytes32
    );
    
    // 验证：代币已锁定
    assertEq(usdc.balanceOf(address(vault)), amount);
    
    // 步骤2: 模拟Guardian签名
    bytes memory vaa = buildVAAFromTransfer(
        transferId,
        guardianSet,
        13  // 13个签名
    );
    
    // 步骤3: 在目标链验证VAA
    bool success = bridgeCore.receiveMessage(vaa);
    assertTrue(success);
    
    // 步骤4: 通过TokenBinding解锁对应代币（模拟）
    // 注：实际在Solana链上通过TokenBinding机制解锁
    bytes32 vaaHash = keccak256(vaa);
    assertTrue(bridgeCore.isVAAConsumed(vaaHash));
}
```

---

### 3.2 Guardian Set升级测试

| 测试ID | 测试场景 | 预期结果 | 优先级 |
|-------|---------|---------|--------|
| INT-004 | Guardian Set升级 | 新旧Set共存7天 | P0 |
| INT-005 | 升级期间跨链 | 旧Set签名仍有效 | P0 |
| INT-006 | 升级后立即跨链 | 新Set签名有效 | P0 |
| INT-007 | 过期后使用旧Set | 拒绝 | P0 |

---

### 3.3 异常场景测试

| 测试ID | 测试场景 | 预期结果 | 优先级 |
|-------|---------|---------|--------|
| INT-008 | 重复提交VAA | 第二次失败 | P0 |
| INT-009 | Gas不足导致失败 | 可重试 | P0 |
| INT-010 | 合约暂停期间操作 | 全部拒绝 | P0 |
| INT-011 | 多合约并发操作 | 无竞态条件 | P1 |

---

## 4. 测试环境配置

### 4.1 Foundry配置

```toml
# foundry.toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc_version = "0.8.20"
optimizer = true
optimizer_runs = 200
via_ir = false

[profile.default.fuzz]
runs = 256
max_test_rejects = 65536

[profile.ci]
fuzz = { runs = 5000 }
invariant = { runs = 1000 }
```

---

### 4.2 测试环境部署

```solidity
// test/Setup.sol
contract TestSetup is Test {
    BridgeCore public bridgeCore;
    TokenVault public vault;
    MockERC20 public usdc;
    
    address public governance = address(0x1);
    address public user = address(0x2);
    
    // Guardian密钥（测试用）
    address[] public guardians;
    
    function setUp() public {
        // 部署合约
        bridgeCore = new BridgeCore();
        vault = new TokenVault(address(bridgeCore));
        usdc = new MockERC20("USD Coin", "USDC", 6);
        
        // 初始化Guardian Set
        guardians = new address[](19);
        for (uint i = 0; i < 19; i++) {
            guardians[i] = vm.addr(i + 1);
        }
        bridgeCore.initialize(guardians, governance);
        
        // 设置测试账户
        vm.deal(user, 100 ether);
        usdc.mint(user, 10_000_000e6);  // 10M USDC
    }
}
```

---

### 4.3 Mock合约

```solidity
// test/mocks/MockERC20.sol
contract MockERC20 is ERC20 {
    uint8 private _decimals;
    
    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals_
    ) ERC20(name, symbol) {
        _decimals = decimals_;
    }
    
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
    
    function decimals() public view override returns (uint8) {
        return _decimals;
    }
}
```

---

## 5. 测试数据准备

### 5.1 测试账户

```solidity
// 测试私钥（仅测试用）
uint256 constant USER_KEY = 0x1234...;
uint256 constant GUARDIAN_0_KEY = 0x5678...;
// ... 19个Guardian私钥

// 派生地址
address user = vm.addr(USER_KEY);
address guardian0 = vm.addr(GUARDIAN_0_KEY);
```

---

### 5.2 测试VAA构造

```solidity
function buildValidVAA(
    address[] memory guardianSet,
    uint8 numSignatures,
    bytes memory payload
) internal returns (bytes memory) {
    // 1. 构造VAA Body
    bytes memory body = abi.encodePacked(
        uint32(block.timestamp),  // timestamp
        uint32(12345),            // nonce
        uint16(1),                // emitterChain
        bytes32(uint256(uint160(address(this)))),  // emitter
        uint64(0),                // sequence
        uint8(200),               // consistencyLevel
        payload
    );
    
    bytes32 bodyHash = keccak256(body);
    
    // 2. Guardian签名
    bytes memory signatures = "";
    for (uint8 i = 0; i < numSignatures; i++) {
        uint256 guardianKey = i + 1;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(guardianKey, bodyHash);
        
        signatures = abi.encodePacked(
            signatures,
            uint8(i),  // guardianIndex
            r,
            s,
            v
        );
    }
    
    // 3. 构造完整VAA
    return abi.encodePacked(
        uint8(1),             // version
        uint32(0),            // guardianSetIndex
        uint8(numSignatures), // signaturesLength
        signatures,
        body
    );
}
```

---

### 5.3 测试代币

```solidity
// 部署测试代币
MockERC20 usdc = new MockERC20("USD Coin", "USDC", 6);
MockERC20 usdt = new MockERC20("Tether USD", "USDT", 6);
MockERC20 weth = new MockERC20("Wrapped Ether", "WETH", 18);

// 铸造测试代币
usdc.mint(user1, 10_000_000e6);  // 10M USDC
usdt.mint(user2, 5_000_000e6);   // 5M USDT
weth.mint(user3, 1000e18);       // 1000 WETH
```

---

### 5.4 Chain ID配置（与SVM一致）

```solidity
// 本地测试使用大魔数避免冲突
uint16 constant LOCAL_CHAIN_ID = 65520;

// 跨链目标
uint16 constant ETHEREUM_MAINNET = 1;
uint16 constant BSC_MAINNET = 56;
uint16 constant POLYGON_MAINNET = 137;
uint16 constant SOLANA_MAINNET = 900;
uint16 constant SOLANA_DEVNET = 901;

// 测试网
uint16 constant SEPOLIA = 11155111;
uint16 constant BSC_TESTNET = 97;
```

**重要说明**:
- ✅ 使用行业标准Chain ID (EIP-155, Wormhole)
- ✅ 本地测试使用65520-65535避免冲突
- ✅ 与SVM子模块保持一致
- ❌ 不使用Foundry默认的31337
- ❌ 不使用1337等常见ID

**参考**: [API-SPEC.md - Chain ID规范](./API-SPEC.md#65-chain-id规范与svm一致)

---

## 6. 测试执行

### 6.1 运行测试

```bash
# 运行所有测试
forge test

# 运行特定合约测试
forge test --match-contract BridgeCoreTest

# 运行特定函数测试
forge test --match-test testPublishMessage

# 显示详细日志
forge test -vvv

# 显示Gas报告
forge test --gas-report

# 显示覆盖率
forge coverage
```

---

### 6.2 测试报告

```bash
# 生成HTML覆盖率报告
forge coverage --report lcov
genhtml lcov.info -o coverage/

# 查看报告
open coverage/index.html
```

---

## 7. CI/CD集成

### 7.1 GitHub Actions配置

```yaml
name: EVM Contracts Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
        with:
          submodules: recursive
      
      - name: Install Foundry
        uses: foundry-rs/foundry-toolchain@v1
      
      - name: Run tests
        run: |
          cd contracts/evm
          forge test -vvv
      
      - name: Check coverage
        run: |
          cd contracts/evm
          forge coverage --report summary
```

---

## 8. 测试指标

### 8.1 覆盖率目标

| 指标 | 目标值 | 当前值 | 状态 |
|-----|--------|--------|------|
| 行覆盖率 | ≥95% | 0% | 📅 |
| 分支覆盖率 | ≥90% | 0% | 📅 |
| 函数覆盖率 | ≥100% | 0% | 📅 |

---

### 8.2 测试完成度

| 合约 | 总用例 | 已完成 | 通过 | 失败 |
|-----|--------|--------|------|------|
| BridgeCore.sol | 25 | 0 | 0 | 0 |
| TokenVault.sol | 20 | 0 | 0 | 0 |
| 管理功能 | 8 | 0 | 0 | 0 |
| 集成测试 | 13 | 0 | 0 | 0 |
| **总计** | **66** | **0** | **0** | **0** |

---

## 附录

### A. 测试最佳实践

1. **命名规范**: `test<FunctionName>_<Scenario>`
2. **断言**: 使用明确的错误消息
3. **隔离性**: 每个测试独立，不依赖其他测试
4. **可读性**: 清晰的注释和步骤说明
5. **边界测试**: 测试边界值和极端情况

### B. 常用测试工具函数

```solidity
// 时间操作
vm.warp(timestamp);  // 设置block.timestamp
vm.roll(blockNumber);  // 设置block.number

// 账户操作
vm.prank(user);  // 下一个调用以user身份
vm.startPrank(user);  // 后续调用都以user身份
vm.stopPrank();

// 余额操作
vm.deal(user, 100 ether);  // 设置ETH余额

// 期望事件
vm.expectEmit(true, true, true, true);
emit EventName(args...);

// 期望回滚
vm.expectRevert(ErrorSelector);
```

### C. 相关文档

- [父项目测试规划](../../../docs/TEST-PLAN.md)
- [Foundry测试文档](https://book.getfoundry.sh/forge/tests)
- [OpenZeppelin测试助手](https://docs.openzeppelin.com/test-helpers/)

---

**文档状态**: ✅ v1.0 已完成  
**维护**: EVM合约测试团队  
**最后更新**: 2025-11-09

