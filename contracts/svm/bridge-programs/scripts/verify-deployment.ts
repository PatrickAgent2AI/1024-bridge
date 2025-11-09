/**
 * 测试网部署验证脚本
 * 检查所有程序和账户的部署状态
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

async function main() {
  console.log("=".repeat(60));
  console.log("Solana Bridge 部署验证脚本");
  console.log("=".repeat(60));

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  console.log("\n环境信息:");
  console.log("  RPC URL:", provider.connection.rpcEndpoint);
  console.log("  Wallet:", provider.wallet.publicKey.toString());

  const balance = await provider.connection.getBalance(provider.wallet.publicKey);
  console.log("  余额:", balance / 1e9, "SOL");

  const coreProgram = anchor.workspace.SolanaCore as Program;
  const tokenProgram = anchor.workspace.TokenBridge as Program;

  let allPassed = true;

  // ========================================
  // 1. 验证程序部署
  // ========================================
  console.log("\n" + "=".repeat(60));
  console.log("检查1: 程序部署状态");
  console.log("=".repeat(60));

  console.log("\nsolana-core:");
  console.log("  Program ID:", coreProgram.programId.toString());
  const coreInfo = await provider.connection.getAccountInfo(coreProgram.programId);
  if (coreInfo && coreInfo.executable) {
    console.log("  ✅ 已部署且可执行");
    console.log("  账户大小:", coreInfo.data.length, "bytes");
    console.log("  Owner:", coreInfo.owner.toString());
  } else {
    console.log("  ❌ 未部署或不可执行");
    allPassed = false;
  }

  console.log("\ntoken-bridge:");
  console.log("  Program ID:", tokenProgram.programId.toString());
  const tokenInfo = await provider.connection.getAccountInfo(tokenProgram.programId);
  if (tokenInfo && tokenInfo.executable) {
    console.log("  ✅ 已部署且可执行");
    console.log("  账户大小:", tokenInfo.data.length, "bytes");
    console.log("  Owner:", tokenInfo.owner.toString());
  } else {
    console.log("  ❌ 未部署或不可执行");
    allPassed = false;
  }

  // ========================================
  // 2. 验证Bridge初始化
  // ========================================
  console.log("\n" + "=".repeat(60));
  console.log("检查2: Bridge初始化状态");
  console.log("=".repeat(60));

  const [bridgePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("Bridge")],
    coreProgram.programId
  );

  console.log("\nBridge账户:");
  console.log("  PDA:", bridgePda.toString());

  try {
    const bridge = await coreProgram.account.bridge.fetch(bridgePda);
    console.log("  ✅ 已初始化");
    console.log("  Guardian Set Index:", bridge.guardianSetIndex);
    console.log("  Message Fee:", bridge.messageFee.toNumber() / 1e9, "SOL");
    console.log("  Paused:", bridge.paused);
  } catch (e) {
    console.log("  ❌ 未初始化");
    console.log("  请运行: ts-node scripts/initialize-testnet.ts");
    allPassed = false;
  }

  // ========================================
  // 3. 验证Guardian Set
  // ========================================
  console.log("\n" + "=".repeat(60));
  console.log("检查3: Guardian Set状态");
  console.log("=".repeat(60));

  const [guardianSetPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("GuardianSet"), Buffer.from([0, 0, 0, 0])],
    coreProgram.programId
  );

  console.log("\nGuardian Set账户:");
  console.log("  PDA:", guardianSetPda.toString());

  try {
    const guardianSet = await coreProgram.account.guardianSet.fetch(guardianSetPda);
    console.log("  ✅ 已初始化");
    console.log("  Index:", guardianSet.index);
    console.log("  Guardian数量:", guardianSet.guardians.length);
    console.log("  创建时间:", new Date(guardianSet.creationTime.toNumber() * 1000).toISOString());
    console.log("  过期时间:", guardianSet.expirationTime === 0 ? "Active" : guardianSet.expirationTime);
    
    // 显示前3个Guardian地址
    console.log("  前3个Guardian:");
    for (let i = 0; i < Math.min(3, guardianSet.guardians.length); i++) {
      const addr = guardianSet.guardians[i];
      console.log(`    ${i}: 0x${Buffer.from(addr).toString('hex')}`);
    }
  } catch (e) {
    console.log("  ❌ 未初始化");
    allPassed = false;
  }

  // ========================================
  // 4. 验证BridgeConfig
  // ========================================
  console.log("\n" + "=".repeat(60));
  console.log("检查4: BridgeConfig状态");
  console.log("=".repeat(60));

  const [bridgeConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("BridgeConfig")],
    tokenProgram.programId
  );

  console.log("\nBridgeConfig账户:");
  console.log("  PDA:", bridgeConfigPda.toString());

  try {
    const config = await tokenProgram.account.bridgeConfig.fetch(bridgeConfigPda);
    console.log("  ✅ 已初始化");
    console.log("  Authority:", config.authority.toString());
    console.log("  Exchange Enabled:", config.exchangeEnabled);
    console.log("  Default Fee BPS:", config.defaultFeeBps);
    console.log("  Fee Recipient:", config.feeRecipient.toString());
    console.log("  Paused:", config.paused);
  } catch (e) {
    console.log("  ❌ 未初始化");
    console.log("  请运行: ts-node scripts/initialize-testnet.ts");
    allPassed = false;
  }

  // ========================================
  // 5. 总结
  // ========================================
  console.log("\n" + "=".repeat(60));
  console.log("验证结果总结");
  console.log("=".repeat(60));

  if (allPassed) {
    console.log("\n✅ 所有检查通过！");
    console.log("\n系统已准备就绪，可以:");
    console.log("  • 注册TokenBinding: ts-node scripts/register-tokens.ts");
    console.log("  • 运行测试: yarn test:testnet");
    console.log("  • 执行跨链转账");
  } else {
    console.log("\n❌ 部分检查失败");
    console.log("\n请执行:");
    console.log("  1. 确保程序已部署: anchor deploy");
    console.log("  2. 初始化合约: ts-node scripts/initialize-testnet.ts");
    console.log("  3. 重新验证: ts-node scripts/verify-deployment.ts");
  }

  console.log();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n验证过程出错:", error);
    process.exit(1);
  });


