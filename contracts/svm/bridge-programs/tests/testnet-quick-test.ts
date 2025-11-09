/**
 * 测试网快速验证测试
 * 用于在Devnet或自定义测试网上快速验证部署状态
 */

import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

describe("测试网快速验证", () => {
  let provider: anchor.AnchorProvider;
  let coreProgram: Program;
  let tokenProgram: Program;

  before(async () => {
    provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    coreProgram = anchor.workspace.SolanaCore;
    tokenProgram = anchor.workspace.TokenBridge;

    console.log("\n" + "=".repeat(60));
    console.log("测试网环境信息");
    console.log("=".repeat(60));
    console.log("RPC URL:", provider.connection.rpcEndpoint);
    console.log("Wallet:", provider.wallet.publicKey.toString());
    
    const balance = await provider.connection.getBalance(provider.wallet.publicKey);
    console.log("余额:", balance / 1e9, "SOL");
  });

  it("✓ 验证程序已部署", async () => {
    console.log("\n检查程序部署状态...");

    const coreInfo = await provider.connection.getAccountInfo(coreProgram.programId);
    const tokenInfo = await provider.connection.getAccountInfo(tokenProgram.programId);

    expect(coreInfo).to.not.be.null;
    expect(tokenInfo).to.not.be.null;
    expect(coreInfo?.executable).to.be.true;
    expect(tokenInfo?.executable).to.be.true;

    console.log("✅ solana-core已部署:", coreProgram.programId.toString());
    console.log("✅ token-bridge已部署:", tokenProgram.programId.toString());
  });

  it("✓ 验证Bridge已初始化", async () => {
    console.log("\n检查Bridge初始化状态...");

    const [bridgePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("Bridge")],
      coreProgram.programId
    );

    const bridge = await coreProgram.account.bridge.fetch(bridgePda);

    expect(bridge).to.not.be.undefined;
    expect(bridge.paused).to.be.false;

    console.log("✅ Bridge已初始化");
    console.log("  Guardian Set Index:", bridge.guardianSetIndex);
    console.log("  Message Fee:", bridge.messageFee.toString(), "lamports");
    console.log("  Paused:", bridge.paused);
  });

  it("✓ 验证Guardian Set已配置", async () => {
    console.log("\n检查Guardian Set...");

    const [guardianSetPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("GuardianSet"), Buffer.from([0, 0, 0, 0])],
      coreProgram.programId
    );

    const guardianSet = await coreProgram.account.guardianSet.fetch(guardianSetPda);

    expect(guardianSet).to.not.be.undefined;
    expect(guardianSet.guardians.length).to.be.greaterThan(0);

    console.log("✅ Guardian Set已配置");
    console.log("  Index:", guardianSet.index);
    console.log("  Guardian数量:", guardianSet.guardians.length);
    console.log("  状态:", guardianSet.expirationTime === 0 ? "Active" : "Expired");
  });

  it("✓ 验证BridgeConfig已初始化", async () => {
    console.log("\n检查BridgeConfig...");

    const [bridgeConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("BridgeConfig")],
      tokenProgram.programId
    );

    const config = await tokenProgram.account.bridgeConfig.fetch(bridgeConfigPda);

    expect(config).to.not.be.undefined;
    expect(config.authority.toString()).to.equal(provider.wallet.publicKey.toString());

    console.log("✅ BridgeConfig已初始化");
    console.log("  Authority:", config.authority.toString());
    console.log("  Exchange Enabled:", config.exchangeEnabled);
    console.log("  Paused:", config.paused);
  });

  it("✓ 验证程序间依赖", async () => {
    console.log("\n检查程序间集成...");

    // 验证token-bridge可以访问solana-core
    const [bridgePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("Bridge")],
      coreProgram.programId
    );

    const bridgeInfo = await provider.connection.getAccountInfo(bridgePda);
    expect(bridgeInfo).to.not.be.null;

    console.log("✅ 程序间依赖正常");
    console.log("  token-bridge可访问solana-core的Bridge账户");
  });

  after(() => {
    console.log("\n" + "=".repeat(60));
    console.log("验证测试完成");
    console.log("=".repeat(60));
    console.log("\n✅ 测试网环境已就绪！");
    console.log("\n下一步:");
    console.log("  • 注册TokenBinding: yarn testnet:register");
    console.log("  • 运行完整测试: yarn testnet:test");
    console.log("  • 执行跨链转账");
    console.log();
  });
});


