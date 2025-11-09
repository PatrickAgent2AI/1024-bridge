/**
 * TokenBinding注册脚本
 * 在测试网上注册代币映射关系
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { createMint } from "@solana/spl-token";

async function main() {
  console.log("=".repeat(60));
  console.log("TokenBinding 注册脚本");
  console.log("=".repeat(60));

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  console.log("\n环境信息:");
  console.log("  RPC URL:", provider.connection.rpcEndpoint);
  console.log("  Authority:", provider.wallet.publicKey.toString());

  const tokenProgram = anchor.workspace.TokenBridge as Program;

  const [bridgeConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("BridgeConfig")],
    tokenProgram.programId
  );

  // ========================================
  // 示例: 注册Solana USDC ↔ Ethereum USDC
  // ========================================
  console.log("\n" + "=".repeat(60));
  console.log("示例: 注册 Solana USDC ↔ Ethereum USDC");
  console.log("=".repeat(60));

  // 1. 创建测试USDC代币（或使用现有的）
  console.log("\n⏳ 创建测试USDC代币...");
  const testUsdcMint = await createMint(
    provider.connection,
    provider.wallet as any,
    provider.wallet.publicKey,
    null,
    6  // USDC decimals
  );
  console.log("✅ 测试USDC Mint:", testUsdcMint.toString());

  // 2. Ethereum USDC地址（示例）
  const ethUsdcAddress = Buffer.alloc(32);
  ethUsdcAddress.writeUInt32BE(0xA0B86991, 0);  // Ethereum USDC前4字节
  console.log("  Ethereum USDC:", "0x" + ethUsdcAddress.toString('hex'));

  // 3. 计算PDA
  const SOL_CHAIN_ID = 900;
  const ETH_CHAIN_ID = 1;

  const [outboundBindingPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("TokenBinding"),
      Buffer.from([0x84, 0x03]),  // 900 LE
      testUsdcMint.toBuffer(),
      Buffer.from([0x01, 0x00]),  // 1 LE
      ethUsdcAddress,
    ],
    tokenProgram.programId
  );

  const [inboundBindingPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("TokenBinding"),
      Buffer.from([0x01, 0x00]),  // 1 LE
      ethUsdcAddress,
      Buffer.from([0x84, 0x03]),  // 900 LE
      testUsdcMint.toBuffer(),
    ],
    tokenProgram.programId
  );

  // 4. 注册双向binding
  console.log("\n⏳ 注册双向TokenBinding...");

  try {
    const tx = await tokenProgram.methods
      .registerBidirectionalBinding(
        SOL_CHAIN_ID,
        Array.from(testUsdcMint.toBuffer()),
        ETH_CHAIN_ID,
        Array.from(ethUsdcAddress),
        new BN(1),    // outbound_rate_num (1:1)
        new BN(1),    // outbound_rate_denom
        new BN(1),    // inbound_rate_num (1:1)
        new BN(1)     // inbound_rate_denom
      )
      .accounts({
        bridgeConfig: bridgeConfigPda,
        outboundBinding: outboundBindingPda,
        inboundBinding: inboundBindingPda,
        authority: provider.wallet.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log("✅ TokenBinding注册成功");
    console.log("  交易签名:", tx);
    console.log("  出站Binding:", outboundBindingPda.toString());
    console.log("  入站Binding:", inboundBindingPda.toString());

    // 验证注册结果
    const outbound = await tokenProgram.account.tokenBinding.fetch(outboundBindingPda);
    const inbound = await tokenProgram.account.tokenBinding.fetch(inboundBindingPda);

    console.log("\n--- 出站Binding (Solana → Ethereum) ---");
    console.log("  Source Chain:", outbound.sourceChain);
    console.log("  Target Chain:", outbound.targetChain);
    console.log("  Exchange Rate:", `${outbound.rateNumerator}:${outbound.rateDenominator}`);
    console.log("  Enabled:", outbound.enabled);

    console.log("\n--- 入站Binding (Ethereum → Solana) ---");
    console.log("  Source Chain:", inbound.sourceChain);
    console.log("  Target Chain:", inbound.targetChain);
    console.log("  Exchange Rate:", `${inbound.rateNumerator}:${inbound.rateDenominator}`);
    console.log("  Enabled:", inbound.enabled);

  } catch (error: any) {
    if (error.message.includes("already in use")) {
      console.log("⚠️  TokenBinding已存在（跳过）");
      
      // 读取现有binding
      try {
        const outbound = await tokenProgram.account.tokenBinding.fetch(outboundBindingPda);
        console.log("  出站Binding已存在，兑换比率:", `${outbound.rateNumerator}:${outbound.rateDenominator}`);
      } catch (e) {
        console.log("  ❌ 读取失败");
        allPassed = false;
      }
    } else {
      console.error("❌ 注册失败:", error.message);
      allPassed = false;
    }
  }

  // ========================================
  // 总结
  // ========================================
  console.log("\n" + "=".repeat(60));
  console.log("验证完成");
  console.log("=".repeat(60));

  if (allPassed) {
    console.log("\n✅ 所有组件正常！");
    console.log("\n测试网环境已就绪:");
    console.log("  • Bridge PDA:", bridgePda.toString());
    console.log("  • 测试USDC:", testUsdcMint.toString());
    console.log("  • TokenBinding已注册");
    console.log("\n可以开始:");
    console.log("  • 运行测试: yarn test:testnet");
    console.log("  • 执行跨链转账测试");
  } else {
    console.log("\n⚠️  部分检查失败，请修复后重试");
  }

  console.log();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n执行出错:", error);
    process.exit(1);
  });


