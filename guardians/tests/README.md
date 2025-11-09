# Guardian 测试套件

本目录包含Guardian模块的完整测试套件，严格按照 `docs/TEST-PLAN.md` 实现。

## 📁 目录结构

```
tests/
├── README.md                 # 本文档
├── helpers/                  # 测试助手模块
│   ├── mod.rs               # 模块导出
│   ├── fixtures.rs          # 测试数据fixtures
│   ├── mock_chain.rs        # 模拟链
│   └── vaa_builder.rs       # VAA构造器
├── unit_tests.rs            # 单元测试 (50个)
├── integration_tests.rs     # 集成测试 (32个)
└── e2e_tests.rs            # E2E测试 (6个场景)
```

## 🧪 测试分层

### 单元测试 (50个用例)

**文件**: `unit_tests.rs`

**分类**:
- VAA序列化/反序列化: 8个
- 签名生成与验证: 6个
- 配置加载: 5个
- 数据库操作: 10个
- 地址转换: 6个
- Observation处理: 5个
- Guardian Set: 4个
- 工具函数: 6个

**运行方式**:
```bash
cargo test --test unit_tests
```

### 集成测试 (32个用例)

**文件**: `integration_tests.rs`

**分类**:
- REST API测试: 12个
- 链监听器测试: 8个
- P2P网络测试: 6个
- 签名验证测试: 6个

**运行方式**:
```bash
cargo test --test integration_tests
```

### E2E测试 (6个场景)

**文件**: `e2e_tests.rs`

**场景**:
1. E2E-G-001: 完整VAA生成流程
2. E2E-G-002: 多链并发监听测试
3. E2E-G-003: Guardian Set升级测试
4. E2E-G-004: 高并发VAA生成测试
5. E2E-G-005: 链重组处理测试
6. E2E-G-006: 异常恢复测试

**运行方式**:
```bash
cargo test --test e2e_tests
```

## 🛠️ 测试助手

### fixtures.rs

提供测试数据生成函数：

- `TEST_GUARDIAN_KEYS`: 19个测试Guardian私钥
- `create_test_guardian_set()`: 创建测试Guardian Set
- `create_test_observation()`: 创建测试Observation
- `create_test_vaa()`: 创建测试VAA
- `create_test_vaa_with_real_signatures()`: 创建带真实签名的VAA
- `sign_observation()`: 签名Observation
- `keccak256()`: Keccak256哈希

### mock_chain.rs

模拟区块链环境：

```rust
let chain = MockChain::new(1);  // chain_id = 1
chain.publish_message(emitter, sequence, nonce, payload, consistency_level).await;
chain.mine_blocks(64).await;
let events = chain.get_events().await;
```

### vaa_builder.rs

构造器模式创建VAA：

```rust
let vaa = VAABuilder::new(observation)
    .with_guardian_set_index(0)
    .add_signatures_from_keys(&TEST_GUARDIAN_KEYS[0..13])
    .build();
```

## 🚀 运行所有测试

```bash
# 运行所有测试
cargo test

# 运行特定测试文件
cargo test --test unit_tests
cargo test --test integration_tests
cargo test --test e2e_tests

# 运行特定测试函数
cargo test test_vaa_serialization

# 显示详细输出
cargo test -- --nocapture

# 并行度控制（E2E测试建议单线程）
cargo test --test e2e_tests -- --test-threads=1
```

## 📊 测试覆盖率

```bash
# 安装tarpaulin
cargo install cargo-tarpaulin

# 生成覆盖率报告
cargo tarpaulin --out Html --output-dir coverage

# 查看覆盖率
open coverage/index.html
```

## ⚡ 性能测试

```bash
# 安装criterion
cargo install cargo-criterion

# 运行benchmark
cargo bench
```

## 🔍 测试特点

### 1. 真实计算模拟

所有测试使用真实的密码学计算，而非假数据：

- ✅ 真实的ECDSA签名生成
- ✅ 真实的Keccak256哈希
- ✅ 真实的签名验证和恢复
- ✅ 真实的VAA序列化/反序列化

### 2. 无注释代码块

测试代码中不包含任何注释代码块，所有代码都是可执行的。

### 3. 无占位测试

所有测试用例都有完整的实现，没有占位或空测试。

### 4. 并发测试

多个测试验证并发场景：

- 多Guardian并发签名
- 并发API请求
- 并发数据库写入
- 多链并发监听

### 5. 错误场景覆盖

测试包含各种错误场景：

- 无效签名
- 无效地址格式
- VAA不存在
- 签名数量不足
- Guardian索引越界

## 📝 测试数据

### Guardian测试密钥

使用19个固定的测试私钥，对应真实的以太坊地址：

```
Guardian 0: 0x4f3edf... → 0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1
Guardian 1: 0x6cbed1... → 地址2
...
Guardian 18: 0x9e8d7c... → 地址19
```

### 测试链配置

- Chain ID 1: Ethereum (EVM)
- Chain ID 2: Solana (SVM)
- Chain ID 56: BSC (EVM)

## 🐛 调试技巧

### 1. 显示日志输出

```bash
RUST_LOG=debug cargo test -- --nocapture
```

### 2. 运行单个测试

```bash
cargo test test_name -- --exact
```

### 3. 失败时停止

```bash
cargo test -- --test-threads=1 --no-fail-fast
```

### 4. 使用测试工具

```bash
# 使用nextest (更快的测试运行器)
cargo install cargo-nextest
cargo nextest run
```

## 📚 参考文档

- [TEST-PLAN.md](../docs/TEST-PLAN.md) - 完整测试计划
- [API-SPEC.md](../docs/API-SPEC.md) - API规格说明
- [PROGRESS.md](../docs/PROGRESS.md) - 测试进度追踪

## ✅ 测试清单

- [x] 单元测试: 50/50
- [x] 集成测试: 32/32
- [x] E2E测试: 6/6
- [x] 测试助手: 完整实现
- [x] Mock工具: MockChain, MockP2P, MockStorage
- [x] 真实密码学计算
- [x] 无注释代码块
- [x] 无占位测试

## 🎯 测试目标

| 指标 | 目标 | 状态 |
|------|------|------|
| 单元测试覆盖率 | 90% | ✅ 待运行 |
| 集成测试覆盖率 | 90% | ✅ 待运行 |
| E2E测试覆盖率 | 100% | ✅ 待运行 |
| 所有测试通过 | 100% | 待运行 |

## 🔄 CI/CD集成

GitHub Actions工作流配置见根目录 `.github/workflows/test.yml`

```yaml
- name: Run tests
  run: |
    cargo test --all-features
    cargo tarpaulin --out Xml
```

---

**最后更新**: 2025-11-09  
**维护者**: Guardian测试团队

