/**
 * 测试网初始化脚本
 * 用于在Devnet或自定义测试网上初始化Bridge和BridgeConfig
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { getGuardianAddresses } from "../tests/utils/setup";

async function main() {
  console.log("=".repeat(60));
  console.log("Solana Bridge 测试网初始化脚本");
  console.log("=".repeat(60));

  // 设置Provider
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  console.log("\n环境信息:");
  console.log("  RPC URL:", provider.connection.rpcEndpoint);
  console.log("  Wallet:", provider.wallet.publicKey.toString());

  // 检查余额
  const balance = await provider.connection.getBalance(provider.wallet.publicKey);
  console.log("  余额:", balance / 1e9, "SOL");

  if (balance < 1e9) {
    console.log("\n⚠️  警告: 余额不足1 SOL，建议至少2 SOL");
    console.log("  请先空投: solana airdrop 2");
    process.exit(1);
  }

  const coreProgram = anchor.workspace.SolanaCore as Program;
  const tokenProgram = anchor.workspace.TokenBridge as Program;

  console.log("\n程序信息:");
  console.log("  solana-core:", coreProgram.programId.toString());
  console.log("  token-bridge:", tokenProgram.programId.toString());

  // ========================================
  // 1. 初始化 solana-core
  // ========================================
  console.log("\n" + "=".repeat(60));
  console.log("步骤1: 初始化 solana-core");
  console.log("=".repeat(60));

  const [bridgePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("Bridge")],
    coreProgram.programId
  );

  const [guardianSetPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("GuardianSet"), Buffer.from([0, 0, 0, 0])],
    coreProgram.programId
  );

  // 检查是否已初始化
  try {
    const bridge = await coreProgram.account.bridge.fetch(bridgePda);
    console.log("\n✅ Bridge已存在");
    console.log("  Guardian Set Index:", bridge.guardianSetIndex);
    console.log("  Message Fee:", bridge.messageFee.toString());
    console.log("  跳过初始化");
  } catch (e) {
    console.log("\n⏳ 正在初始化Bridge...");

    // 使用测试Guardian地址
    const guardians = getGuardianAddresses();
    console.log("  Guardian数量:", guardians.length);

    try {
      const tx = await coreProgram.methods
        .initialize(
          0,                          // guardian_set_index
          guardians,                  // guardians (19个)
          new BN(1_000_000)          // message_fee (0.001 SOL)
        )
        .accounts({
          bridge: bridgePda,
          guardianSet: guardianSetPda,
          payer: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      console.log("✅ Bridge初始化成功");
      console.log("  交易签名:", tx);
      console.log("  Bridge PDA:", bridgePda.toString());
      console.log("  Guardian Set PDA:", guardianSetPda.toString());
    } catch (error: any) {
      console.error("❌ 初始化失败:", error.message);
      throw error;
    }
  }

  // ========================================
  // 2. 初始化 token-bridge
  // ========================================
  console.log("\n" + "=".repeat(60));
  console.log("步骤2: 初始化 token-bridge");
  console.log("=".repeat(60));

  const [bridgeConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("BridgeConfig")],
    tokenProgram.programId
  );

  // 检查是否已初始化
  try {
    const config = await tokenProgram.account.bridgeConfig.fetch(bridgeConfigPda);
    console.log("\n✅ BridgeConfig已存在");
    console.log("  Authority:", config.authority.toString());
    console.log("  Exchange Enabled:", config.exchangeEnabled);
    console.log("  跳过初始化");
  } catch (e) {
    console.log("\n⏳ 正在初始化BridgeConfig...");

    try {
      const tx = await tokenProgram.methods
        .initialize(provider.wallet.publicKey)
        .accounts({
          bridgeConfig: bridgeConfigPda,
          payer: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      console.log("✅ BridgeConfig初始化成功");
      console.log("  交易签名:", tx);
      console.log("  BridgeConfig PDA:", bridgeConfigPda.toString());
      console.log("  Authority:", provider.wallet.publicKey.toString());
    } catch (error: any) {
      console.error("❌ 初始化失败:", error.message);
      throw error;
    }
  }

  // ========================================
  // 3. 最终验证
  // ========================================
  console.log("\n" + "=".repeat(60));
  console.log("步骤3: 最终验证");
  console.log("=".repeat(60));

  const bridge = await coreProgram.account.bridge.fetch(bridgePda);
  const guardianSet = await coreProgram.account.guardianSet.fetch(guardianSetPda);
  const bridgeConfig = await tokenProgram.account.bridgeConfig.fetch(bridgeConfigPda);

  console.log("\n✅ 所有组件已初始化");
  console.log("\n--- solana-core 状态 ---");
  console.log("  Bridge PDA:", bridgePda.toString());
  console.log("  Guardian Set Index:", bridge.guardianSetIndex);
  console.log("  Guardian数量:", guardianSet.guardians.length);
  console.log("  Message Fee:", bridge.messageFee.toNumber() / 1e9, "SOL");
  console.log("  Paused:", bridge.paused);

  console.log("\n--- token-bridge 状态 ---");
  console.log("  BridgeConfig PDA:", bridgeConfigPda.toString());
  console.log("  Authority:", bridgeConfig.authority.toString());
  console.log("  Exchange Enabled:", bridgeConfig.exchangeEnabled);
  console.log("  Default Fee BPS:", bridgeConfig.defaultFeeBps);

  console.log("\n" + "=".repeat(60));
  console.log("🎉 初始化完成！");
  console.log("=".repeat(60));
  console.log("\n下一步:");
  console.log("  1. 运行验证脚本: ts-node scripts/verify-deployment.ts");
  console.log("  2. 注册TokenBinding: ts-node scripts/register-tokens.ts");
  console.log("  3. 运行测试: yarn test:testnet");
  console.log();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });


