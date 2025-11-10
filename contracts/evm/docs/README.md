# EVM合约子模块文档目录

> **版本**: v2.0  
> **最后更新**: 2025-11-10  
> **状态**: ✅ 设计完成，参考SVM v1.5架构

---

## 📚 文档索引

| 文档 | 版本 | 说明 | 链接 |
|------|------|------|------|
| **README.md** | v2.0 | 项目概述、架构设计、目录结构 | [查看](../README.md) |
| **API-SPEC.md** | v2.0 | 接口规范、数据结构、错误码 | [查看](./API-SPEC.md) |
| **TEST-PLAN.md** | v2.0 | 测试计划、测试用例、测试工具 | [查看](./TEST-PLAN.md) |
| **PROGRESS.md** | v2.0 | 开发进度、变更记录、待办事项 | [查看](./PROGRESS.md) |

---

## 🎯 v2.0 核心特性

### 1. TokenBinding机制

- ✅ 替代包装代币模式
- ✅ 4元组映射（sourceChain, sourceToken, targetChain, targetToken）
- ✅ 支持多对多关系
- ✅ 支持跨币种兑换（USDC → USDT）
- ✅ 与SVM子模块完全对称

### 2. Gnosis Safe多签

- ✅ 使用Gnosis Safe作为owner
- ✅ 推荐配置：3/5或4/7签名门限
- ✅ 所有管理操作需多签批准
- ✅ 无需实现多签钱包生成

### 3. Chain ID规范（与SVM一致）

| Chain ID | 网络 | 类型 |
|----------|------|------|
| 1 | Ethereum Mainnet | EVM |
| 56 | BSC | EVM |
| 137 | Polygon | EVM |
| 900 | Solana Mainnet | SVM |
| 901 | Solana Devnet | SVM |
| 65520-65535 | 本地测试 | 通用 |

**重要说明**:
- ✅ 使用行业标准Chain ID (EIP-155, Wormhole)
- ✅ 本地测试使用大魔数65520-65535避免冲突
- ❌ 不使用31337、1337等非标准ID

### 4. 133字节Payload对称

```
Offset | Size | Field              | 说明
-------|------|--------------------|------
0      | 1    | payloadType        | 固定值1
1      | 8    | amount             | 源链锁定数量
9      | 32   | tokenAddress       | 源链代币地址
41     | 2    | tokenChain         | 源链ID
43     | 32   | recipient          | 接收者地址
75     | 2    | recipientChain     | 目标链ID
77     | 32   | targetToken        | 目标链代币地址
109    | 8    | targetAmount       | 目标链接收数量
117    | 8    | exchangeRateNum    | 兑换比率分子
125    | 8    | exchangeRateDenom  | 兑换比率分母
```

**与SVM完全一致**，确保跨链互操作性。

---

## 🔄 v2.0 变更总结

### 接口变更

**lockTokens** (扩展):
```solidity
// v1.0
function lockTokens(
    address token, uint256 amount, 
    uint16 targetChainId, bytes32 recipient
) external payable returns (bytes32);

// v2.0 - 新增targetToken参数
function lockTokens(
    address sourceToken, uint256 amount, 
    uint16 targetChain, bytes32 targetToken, bytes32 recipient
) external payable returns (bytes32);
```

**新增函数**:
- `registerTokenBinding` - 注册单向代币绑定
- `registerBidirectionalBinding` - 注册双向代币绑定（推荐）
- `setExchangeRate` - 动态更新兑换比率
- `setTokenBindingEnabled` - 启用/禁用绑定
- `updateAMMConfig` - AMM集成（预留）
- `initializeCustody` - 初始化代币托管

### 数据结构变更

**新增**: `TokenBinding`
```solidity
struct TokenBinding {
    uint16 sourceChain;
    bytes32 sourceToken;
    uint16 targetChain;
    bytes32 targetToken;
    uint64 exchangeRateNumerator;
    uint64 exchangeRateDenominator;
    bool enabled;
}
```

**扩展**: 事件定义
- `TokensLocked` - 新增targetToken和targetAmount字段
- `TokensUnlocked` - 新增sourceChain和sourceToken字段
- 新增TokenBinding相关事件

---

## 📊 文档更新状态

| 文档 | v1.0 | v2.0 | 状态 |
|------|------|------|------|
| README.md | ✅ | ✅ | 已更新 |
| API-SPEC.md | ✅ | ✅ | 已更新 |
| TEST-PLAN.md | ✅ | 🔄 | 部分更新 |
| PROGRESS.md | ✅ | ✅ | 已更新 |

**说明**:
- README.md: 完全更新到v2.0
- API-SPEC.md: 完全更新到v2.0，包含Chain ID规范
- TEST-PLAN.md: Chain ID配置已更新，测试用例需后续更新
- PROGRESS.md: 完全更新到v2.0，包含变更记录

---

## 🎓 学习路径

### 新手入门

1. 阅读 [README.md](../README.md) 了解项目概述
2. 阅读 [API-SPEC.md - 模块概述](./API-SPEC.md#1-模块概述) 理解架构
3. 查看 [API-SPEC.md - TokenBinding机制](./API-SPEC.md#12-核心设计概念) 理解核心创新

### 开发人员

1. 阅读 [API-SPEC.md - 合约接口](./API-SPEC.md#2-bridgecore合约接口) 了解所有函数
2. 查看 [API-SPEC.md - 数据结构](./API-SPEC.md#6-数据结构定义) 理解数据格式
3. 参考 [TEST-PLAN.md](./TEST-PLAN.md) 规划测试用例
4. 对比 [SVM子模块](../../svm/docs/API-SPEC.md) 确保对称性

### 集成人员

1. 阅读 [API-SPEC.md - 集成指南](./API-SPEC.md#8-接口集成指南) 了解集成流程
2. 查看 [API-SPEC.md - Chain ID规范](./API-SPEC.md#65-chain-id规范与svm一致) 确认链ID
3. 参考 [Gnosis Safe文档](https://docs.safe.global/) 配置多签

---

## 🔗 相关资源

### 内部资源

- **主项目**: [../../../README.md](../../../README.md)
- **SVM子模块**: [../../svm/](../../svm/)
- **SVM API规范**: [../../svm/docs/API-SPEC.md](../../svm/docs/API-SPEC.md)

### 外部资源

- **Gnosis Safe**: https://docs.safe.global/
- **Foundry**: https://book.getfoundry.sh/
- **OpenZeppelin**: https://docs.openzeppelin.com/contracts/
- **Chain ID列表**: https://chainlist.org/
- **Wormhole文档**: https://docs.wormhole.com/

---

## ❓ 常见问题

### Q1: 为什么使用TokenBinding而不是包装代币？

**A**: TokenBinding利用现有流动性，支持跨币种兑换，用户体验更好。详见 [API-SPEC.md - TokenBinding机制](./API-SPEC.md#tokenbinding机制)。

### Q2: Gnosis Safe需要自己实现吗？

**A**: 不需要。直接使用现有的Gnosis Safe多签钱包，将其地址设为合约的owner即可。

### Q3: 为什么本地测试用65520-65535？

**A**: 这是大魔数范围，避免与主流测试网（如Sepolia: 11155111）和开发网冲突，确保测试环境隔离。

### Q4: Chain ID必须与SVM一致吗？

**A**: 是的。这是跨链互操作的前提，两条链必须使用相同的Chain ID标识才能正确跨链。

### Q5: 133字节Payload能否修改？

**A**: 不建议。Payload格式与SVM完全对称，修改会破坏跨链兼容性。如需扩展，应使用新的payloadType。

---

**文档维护**: EVM合约开发团队  
**最后更新**: 2025-11-10  
**版本**: v2.0
