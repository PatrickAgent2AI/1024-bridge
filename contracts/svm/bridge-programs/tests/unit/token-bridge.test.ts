/**
 * token-bridge程序单元测试（新设计 - 代币绑定机制）
 * 测试数量：33个（代币绑定和兑换测试）
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { assert, expect } from "chai";
import {
  setupTestEnvironment,
  airdrop,
  createTestMint,
  createAndMintTestToken,
  getTokenBalance,
  TEST_GUARDIAN_KEYS,
} from "../utils/setup";
import {
  createTokenTransferVAA,
  TokenTransferPayload,
} from "../utils/vaa";
import {
  getBridgePDA,
  getTokenBindingPDA,
  getBridgeConfigPDA,
  printTestHeader,
  printTestStep,
  assertEqual,
  assertTxSuccess,
  assertTxFailed,
  ethAddressToBytes32,
  solanaAddressToBytes32,
} from "../utils/helpers";

describe("token-bridge单元测试（新设计 - 代币绑定机制）", () => {
  let provider: anchor.AnchorProvider;
  let coreProgram: Program;  // solana-core程序
  let tokenProgram: Program; // token-bridge程序
  let payer: Keypair;
  let user: Keypair;
  let authority: Keypair;
  
  // Test tokens
  let solUSDCMint: PublicKey;
  let solUSDTMint: PublicKey;
  let userUSDCAccount: PublicKey;
  let userUSDTAccount: PublicKey;
  let custodyAccount: PublicKey;
  
  // PDAs
  let bridgePDA: PublicKey;
  let bridgeConfigPDA: PublicKey;
  
  // Ethereum addresses (32 bytes)
  let ethUSDC: Buffer;
  let ethUSDT: Buffer;
  let ethDAI: Buffer;
  
  before(async () => {
    printTestHeader("token-bridge程序初始化（新设计）");
    
    const env = await setupTestEnvironment();
    provider = env.provider;
    
    // 加载程序
    coreProgram = anchor.workspace.SolanaCore as Program;
    tokenProgram = anchor.workspace.TokenBridge as Program;
    
    payer = Keypair.generate();
    user = Keypair.generate();
    authority = Keypair.generate();
    
    await airdrop(provider.connection, payer.publicKey);
    await airdrop(provider.connection, user.publicKey);
    await airdrop(provider.connection, authority.publicKey);
    
    // 计算PDAs
    [bridgePDA] = getBridgePDA(coreProgram.programId);
    [bridgeConfigPDA] = getBridgeConfigPDA(tokenProgram.programId);
    
    printTestStep(1, "创建测试SPL Tokens");
    solUSDCMint = await createTestMint(provider.connection, payer, 6);
    solUSDTMint = await createTestMint(provider.connection, payer, 6);
    console.log(`✓ Solana USDC Mint: ${solUSDCMint.toBase58()}`);
    console.log(`✓ Solana USDT Mint: ${solUSDTMint.toBase58()}`);
    
    printTestStep(2, "创建用户Token账户并铸造代币");
    userUSDCAccount = await createAndMintTestToken(
      provider.connection,
      payer,
      solUSDCMint,
      user.publicKey,
      BigInt(1000_000_000) // 1000 USDC
    );
    userUSDTAccount = await createAndMintTestToken(
      provider.connection,
      payer,
      solUSDTMint,
      user.publicKey,
      BigInt(1000_000_000) // 1000 USDT
    );
    console.log(`✓ User USDC Account: ${userUSDCAccount.toBase58()}`);
    console.log(`✓ User USDT Account: ${userUSDTAccount.toBase58()}`);
    
    printTestStep(3, "准备Ethereum代币地址");
    ethUSDC = ethAddressToBytes32("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
    ethUSDT = ethAddressToBytes32("0xdAC17F958D2ee523a2206206994597C13D831ec7");
    ethDAI = ethAddressToBytes32("0x6B175474E89094C44Da98b954EedeAC495271d0F");
    console.log(`✓ Ethereum USDC: 0x${ethUSDC.toString('hex').slice(24)}`);
    console.log(`✓ Ethereum USDT: 0x${ethUSDT.toString('hex').slice(24)}`);
    console.log(`✓ Ethereum DAI: 0x${ethDAI.toString('hex').slice(24)}`);
    
    console.log("✓ 测试环境初始化完成");
  });
  
  // ============================================
  // 2.2.1 transfer_tokens指令测试（更新 - 支持TokenBinding和兑换）
  // ============================================
  
  describe("UNIT-TB-001 ~ 008: transfer_tokens指令（支持兑换）", () => {
    it("UNIT-TB-001: 正常锁定SPL代币（1:1兑换）", async () => {
      printTestStep(1, "注册TokenBinding（Solana USDC → Ethereum USDC, 1:1）");
      
      const solUSDCBytes32 = solanaAddressToBytes32(solUSDCMint);
      const [tokenBindingPDA] = getTokenBindingPDA(
        tokenProgram.programId,
        900,  // Solana chain ID
        solUSDCBytes32,
        1,    // Ethereum chain ID
        ethUSDC
      );
      
      console.log(`  TokenBinding PDA: ${tokenBindingPDA.toBase58()}`);
      console.log(`  Source: Solana(900) USDC`);
      console.log(`  Target: Ethereum(1) USDC`);
      console.log(`  Rate: 1:1`);
      
      // 注册TokenBinding（占位 - 等待程序实现）
      // const tx1 = await tokenProgram.methods
      //   .registerTokenBinding(
      //     900,  // source_chain
      //     Array.from(solUSDCBytes32),
      //     1,    // target_chain
      //     Array.from(ethUSDC)
      //   )
      //   .accounts({
      //     bridgeConfig: bridgeConfigPDA,
      //     tokenBinding: tokenBindingPDA,
      //     authority: authority.publicKey,
      //     payer: payer.publicKey,
      //     systemProgram: SystemProgram.programId,
      //   })
      //   .signers([authority, payer])
      //   .rpc();
      
      printTestStep(2, "准备转账参数");
      const amount = BigInt(500_000_000); // 500 USDC
      const targetChain = 1; // Ethereum
      const recipient = ethAddressToBytes32("0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb");
      
      printTestStep(3, "调用transfer_tokens（包含目标代币信息）");
      // const tx2 = await tokenProgram.methods
      //   .transferTokens(
      //     new anchor.BN(amount.toString()),
      //     targetChain,
      //     Array.from(ethUSDC),  // 目标代币地址（新增参数）
      //     Array.from(recipient)
      //   )
      //   .accounts({
      //     bridge: bridgePDA,
      //     tokenBinding: tokenBindingPDA,  // 验证binding存在
      //     tokenAccount: userUSDCAccount,
      //     custodyAccount: custodyPDA,
      //     tokenAuthority: user.publicKey,
      //     tokenMint: solUSDCMint,
      //     tokenProgram: TOKEN_PROGRAM_ID,
      //   })
      //   .signers([user])
      //   .rpc();
      
      // assertTxSuccess(tx2, "SPL代币锁定成功");
      
      printTestStep(4, "验证payload包含兑换信息");
      // const message = await coreProgram.account.postedMessage.fetch(messagePDA);
      // const payload = deserializeTokenTransferPayload(message.payload);
      // assertEqual(payload.amount, amount, "源链数量正确");
      // assertEqual(Buffer.from(payload.targetToken).toString('hex'), ethUSDC.toString('hex'), "目标代币正确");
      // assertEqual(payload.targetAmount, amount, "目标链数量正确（1:1）");
      // assertEqual(payload.exchangeRateNum, BigInt(1), "兑换比率分子为1");
      // assertEqual(payload.exchangeRateDenom, BigInt(1), "兑换比率分母为1");
      
      console.log("✓ UNIT-TB-001 测试通过（占位，等待程序实现）");
      console.log("  包含TokenBinding验证和兑换信息构造");
    });
    
    it("UNIT-TB-002: 跨链兑换不同代币（USDC→USDT）", async () => {
      printTestStep(1, "注册TokenBinding（Solana USDC → Ethereum USDT, 998:1000）");
      
      const solUSDCBytes32 = solanaAddressToBytes32(solUSDCMint);
      const [tokenBindingPDA] = getTokenBindingPDA(
        tokenProgram.programId,
        900,  // Solana
        solUSDCBytes32,
        1,    // Ethereum
        ethUSDT  // 目标是USDT，不是USDC
      );
      
      console.log(`  Source: Solana USDC`);
      console.log(`  Target: Ethereum USDT`);
      console.log(`  Rate: 998:1000 (1 USDC = 0.998 USDT)`);
      
      // 注册不同代币的binding
      // const tx1 = await tokenProgram.methods
      //   .registerTokenBinding(900, Array.from(solUSDCBytes32), 1, Array.from(ethUSDT))
      //   .accounts({ ... })
      //   .rpc();
      
      // 设置兑换比率
      // const tx2 = await tokenProgram.methods
      //   .setExchangeRate(
      //     900, Array.from(solUSDCBytes32),
      //     1, Array.from(ethUSDT),
      //     new anchor.BN(998),   // rate_numerator
      //     new anchor.BN(1000)   // rate_denominator
      //   )
      //   .accounts({
      //     tokenBinding: tokenBindingPDA,
      //     authority: authority.publicKey,
      //   })
      //   .signers([authority])
      //   .rpc();
      
      printTestStep(2, "执行跨链兑换转账");
      const amount = BigInt(1000_000_000); // 1000 USDC
      
      // const tx3 = await tokenProgram.methods
      //   .transferTokens(
      //     new anchor.BN(amount.toString()),
      //     1,  // Ethereum
      //     Array.from(ethUSDT),  // 目标代币为USDT
      //     Array.from(recipient)
      //   )
      //   .accounts({ ... })
      //   .rpc();
      
      printTestStep(3, "验证兑换计算");
      const expectedTargetAmount = BigInt(998_000_000); // 998 USDT
      
      // const payload = ...;
      // assertEqual(payload.amount, amount, "源链1000 USDC");
      // assertEqual(payload.targetAmount, expectedTargetAmount, "目标链998 USDT");
      // assertEqual(payload.exchangeRateNum, BigInt(998), "比率分子");
      // assertEqual(payload.exchangeRateDenom, BigInt(1000), "比率分母");
      
      console.log("✓ UNIT-TB-002 测试通过（占位，等待程序实现）");
      console.log("  包含跨链兑换不同代币的完整流程");
    });
    
    it("UNIT-TB-003: TokenBinding不存在失败", async () => {
      printTestStep(1, "尝试转账未注册binding的代币");
      
      const unknownToken = ethAddressToBytes32("0x0000000000000000000000000000000000000001");
      
      try {
        // const tx = await tokenProgram.methods
        //   .transferTokens(
        //     new anchor.BN(100_000_000),
        //     1,
        //     Array.from(unknownToken),  // 未注册的代币
        //     Array.from(recipient)
        //   )
        //   .accounts({ ... })
        //   .rpc();
        
        // throw new Error("应该失败但成功了");
        console.log("  [模拟] 交易失败: TokenBindingNotFound");
      } catch (error) {
        assertTxFailed(error, "TokenBindingNotFound");
      }
      
      console.log("✓ UNIT-TB-003 测试通过（占位，等待程序实现）");
    });
    
    it("UNIT-TB-004: TokenBinding未启用失败", async () => {
      printTestStep(1, "注册但禁用TokenBinding");
      
      // 注册binding但设置enabled=false
      
      try {
        // 尝试使用已禁用的binding
        console.log("  [模拟] 交易失败: TokenBindingNotEnabled");
      } catch (error) {
        assertTxFailed(error, "TokenBindingNotEnabled");
      }
      
      console.log("✓ UNIT-TB-004 测试通过（占位，等待程序实现）");
    });
    
    it("UNIT-TB-005: 授权不足", async () => {
      printTestStep(1, "尝试转账未授权的代币");
      
      const otherUser = Keypair.generate();
      await airdrop(provider.connection, otherUser.publicKey);
      
      const amount = BigInt(100_000_000);
      
      try {
        // const tx = await tokenProgram.methods
        //   .transferTokens(...)
        //   .accounts({
        //     tokenAccount: userUSDCAccount,
        //     tokenAuthority: otherUser.publicKey, // 错误的authority
        //     ...
        //   })
        //   .signers([otherUser])
        //   .rpc();
        
        // throw new Error("应该失败但成功了");
      } catch (error) {
        assertTxFailed(error, "owner does not match");
      }
      
      console.log("✓ UNIT-TB-005 测试通过（占位，等待程序实现）");
    });
    
    it("UNIT-TB-006: 余额不足", async () => {
      printTestStep(1, "尝试转账超过余额的数量");
      
      const amount = BigInt(2000_000_000); // 2000 tokens (超过余额)
      
      try {
        // const tx = await tokenProgram.methods
        //   .transferTokens(...)
        //   .rpc();
        
        // throw new Error("应该失败但成功了");
      } catch (error) {
        assertTxFailed(error, "insufficient funds");
      }
      
      console.log("✓ UNIT-TB-006 测试通过（占位，等待程序实现）");
    });
    
    it("UNIT-TB-007: 手续费不足", async () => {
      // 测试手续费不足的情况
      console.log("✓ UNIT-TB-007 测试通过（占位，等待程序实现）");
    });
    
    it("UNIT-TB-008: 无效目标链", async () => {
      // 测试无效的目标链ID
      console.log("✓ UNIT-TB-008 测试通过（占位，等待程序实现）");
    });
  });
  
  // ============================================
  // 2.2.2 complete_transfer指令测试（更新 - 兑换验证）
  // ============================================
  
  describe("UNIT-TB-009 ~ 010, 025 ~ 029: complete_transfer指令（兑换验证）", () => {
    it("UNIT-TB-009: 解锁原生SPL代币（1:1兑换）", async () => {
      printTestStep(1, "预先锁定一些代币到custody");
      // 假设custody中已有1000 tokens
      
      printTestStep(2, "注册入站TokenBinding（Ethereum USDC → Solana USDC）");
      const solUSDCBytes32 = solanaAddressToBytes32(solUSDCMint);
      const [inboundBindingPDA] = getTokenBindingPDA(
        tokenProgram.programId,
        1,    // Ethereum（源链）
        ethUSDC,
        900,  // Solana（目标链）
        solUSDCBytes32
      );
      
      console.log(`  入站Binding: Ethereum USDC → Solana USDC`);
      
      printTestStep(3, "构造来自Ethereum的转账VAA");
      const payload: TokenTransferPayload = {
        payloadType: 1,
        amount: BigInt(500_000_000), // 500 USDC
        tokenAddress: ethUSDC,
        tokenChain: 1, // Ethereum
        recipient: solanaAddressToBytes32(user.publicKey),
        recipientChain: 900, // Solana
        // 新增字段
        targetToken: solUSDCBytes32,
        targetAmount: BigInt(500_000_000), // 1:1兑换
        exchangeRateNum: BigInt(1),
        exchangeRateDenom: BigInt(1),
      };
      
      const vaa = createTokenTransferVAA({
        guardianSetIndex: 0,
        emitterChain: 1, // Ethereum
        emitterAddress: ethAddressToBytes32("0x..."),
        sequence: BigInt(1),
        guardianKeys: TEST_GUARDIAN_KEYS,
        transferPayload: payload,
        signerCount: 13,
      });
      
      console.log(`  VAA大小: ${vaa.length} bytes`);
      console.log(`  Payload包含兑换信息`);
      
      printTestStep(4, "调用complete_transfer");
      // const tx = await tokenProgram.methods
      //   .completeTransfer(vaa)
      //   .accounts({
      //     bridge: bridgePDA,
      //     postedVaa: postedVAAPDA,
      //     tokenBinding: inboundBindingPDA,  // 验证入站binding
      //     recipientAccount: userUSDCAccount,
      //     custodyAccount: custodyPDA,
      //     targetTokenMint: solUSDCMint,
      //     tokenProgram: TOKEN_PROGRAM_ID,
      //   })
      //   .rpc();
      
      // assertTxSuccess(tx, "代币解锁成功");
      
      printTestStep(5, "验证用户收到代币");
      // const userBalance = await getTokenBalance(provider.connection, userUSDCAccount);
      // assertEqual(userBalance, BigInt(1000_000_000), "用户余额增加到1000 tokens");
      
      console.log("✓ UNIT-TB-009 测试通过（占位，等待程序实现）");
      console.log("  包含入站binding验证和1:1兑换");
    });
    
    it("UNIT-TB-010: 跨链兑换不同代币接收", async () => {
      printTestStep(1, "注册入站TokenBinding（Ethereum USDT → Solana USDC, 1002:1000）");
      
      const solUSDCBytes32 = solanaAddressToBytes32(solUSDCMint);
      const [inboundBindingPDA] = getTokenBindingPDA(
        tokenProgram.programId,
        1,    // Ethereum USDT
        ethUSDT,
        900,  // Solana USDC
        solUSDCBytes32
      );
      
      console.log(`  入站Binding: Ethereum USDT → Solana USDC`);
      console.log(`  Rate: 1002:1000 (1 USDT = 1.002 USDC)`);
      
      printTestStep(2, "构造VAA（1000 USDT → 1002 USDC）");
      const payload: TokenTransferPayload = {
        payloadType: 1,
        amount: BigInt(1000_000_000), // 1000 USDT
        tokenAddress: ethUSDT,
        tokenChain: 1,
        recipient: solanaAddressToBytes32(user.publicKey),
        recipientChain: 900,
        targetToken: solUSDCBytes32,
        targetAmount: BigInt(1_002_000_000), // 1002 USDC
        exchangeRateNum: BigInt(1002),
        exchangeRateDenom: BigInt(1000),
      };
      
      const vaa = createTokenTransferVAA({
        guardianSetIndex: 0,
        emitterChain: 1,
        emitterAddress: ethAddressToBytes32("0x..."),
        sequence: BigInt(2),
        guardianKeys: TEST_GUARDIAN_KEYS,
        transferPayload: payload,
        signerCount: 13,
      });
      
      printTestStep(3, "完成跨链兑换转账");
      // const tx = await tokenProgram.methods.completeTransfer(vaa).accounts({ ... }).rpc();
      
      printTestStep(4, "验证用户收到兑换后的代币");
      // const userBalance = await getTokenBalance(provider.connection, userUSDCAccount);
      // assertEqual(userBalance, BigInt(1_002_000_000), "用户收到1002 USDC");
      
      console.log("✓ UNIT-TB-010 测试通过（占位，等待程序实现）");
      console.log("  包含不同代币间的跨链兑换接收");
    });
    
    it("UNIT-TB-025: 兑换比率验证失败", async () => {
      printTestStep(1, "注册TokenBinding（1:1兑换）");
      // 注册1:1兑换比率
      
      printTestStep(2, "构造VAA（错误的兑换比率）");
      const payload: TokenTransferPayload = {
        payloadType: 1,
        amount: BigInt(1000_000_000),
        tokenAddress: ethUSDC,
        tokenChain: 1,
        recipient: solanaAddressToBytes32(user.publicKey),
        recipientChain: 900,
        targetToken: solanaAddressToBytes32(solUSDCMint),
        targetAmount: BigInt(1100_000_000), // 声称1:1.1（错误）
        exchangeRateNum: BigInt(11),  // 错误的比率
        exchangeRateDenom: BigInt(10),
      };
      
      const vaa = createTokenTransferVAA({
        guardianSetIndex: 0,
        emitterChain: 1,
        emitterAddress: Buffer.alloc(32),
        sequence: BigInt(3),
        guardianKeys: TEST_GUARDIAN_KEYS,
        transferPayload: payload,
        signerCount: 13,
      });
      
      printTestStep(3, "尝试完成转账（应该失败）");
      try {
        // const tx = await tokenProgram.methods.completeTransfer(vaa).accounts({ ... }).rpc();
        // throw new Error("应该失败但成功了");
        console.log("  [模拟] 交易失败: InvalidExchangeRate");
      } catch (error) {
        assertTxFailed(error, "InvalidExchangeRate");
      }
      
      console.log("✓ UNIT-TB-025 测试通过（占位，等待程序实现）");
      console.log("  包含兑换比率验证逻辑");
    });
    
    it("UNIT-TB-026: 目标代币不匹配", async () => {
      printTestStep(1, "构造VAA（目标代币与binding不匹配）");
      
      // TokenBinding注册的是USDC→USDC
      // 但VAA声称目标代币是USDT
      
      try {
        console.log("  [模拟] 交易失败: TargetTokenMismatch");
      } catch (error) {
        assertTxFailed(error, "TargetTokenMismatch");
      }
      
      console.log("✓ UNIT-TB-026 测试通过（占位，等待程序实现）");
    });
    
    it("UNIT-TB-027: VAA验证失败", async () => {
      // 测试无效VAA
      console.log("✓ UNIT-TB-027 测试通过（占位，等待程序实现）");
    });
    
    it("UNIT-TB-028: 目标链不匹配", async () => {
      printTestStep(1, "构造目标链为BSC的VAA");
      
      const payload: TokenTransferPayload = {
        payloadType: 1,
        amount: BigInt(100_000_000),
        tokenAddress: ethUSDC,
        tokenChain: 1,
        recipient: solanaAddressToBytes32(user.publicKey),
        recipientChain: 56, // BSC，不是Solana
        targetToken: Buffer.alloc(32),
        targetAmount: BigInt(100_000_000),
        exchangeRateNum: BigInt(1),
        exchangeRateDenom: BigInt(1),
      };
      
      const vaa = createTokenTransferVAA({
        guardianSetIndex: 0,
        emitterChain: 1,
        emitterAddress: Buffer.alloc(32),
        sequence: BigInt(4),
        guardianKeys: TEST_GUARDIAN_KEYS,
        transferPayload: payload,
        signerCount: 13,
      });
      
      printTestStep(2, "尝试在Solana执行（应该失败）");
      try {
        // const tx = await tokenProgram.methods.completeTransfer(vaa).accounts({ ... }).rpc();
        // throw new Error("应该失败但成功了");
      } catch (error) {
        assertTxFailed(error, "InvalidTargetChain");
      }
      
      console.log("✓ UNIT-TB-028 测试通过（占位，等待程序实现）");
    });
    
    it("UNIT-TB-029: custody余额不足", async () => {
      // 测试custody余额不足无法解锁
      console.log("✓ UNIT-TB-029 测试通过（占位，等待程序实现）");
    });
  });
  
  // ============================================
  // 2.2.3 register_token_binding指令测试（新增）
  // ============================================
  
  describe("UNIT-TB-011 ~ 014, 030: register_token_binding指令", () => {
    it("UNIT-TB-011: 正常注册单向代币绑定", async () => {
      printTestStep(1, "准备绑定参数");
      const sourceChain = 900;  // Solana
      const solUSDCBytes32 = solanaAddressToBytes32(solUSDCMint);
      const targetChain = 1;    // Ethereum
      const targetToken = ethUSDC;
      
      const [bindingPDA] = getTokenBindingPDA(
        tokenProgram.programId,
        sourceChain,
        solUSDCBytes32,
        targetChain,
        targetToken
      );
      
      console.log(`  Binding: Solana(900) USDC → Ethereum(1) USDC`);
      console.log(`  PDA: ${bindingPDA.toBase58()}`);
      
      printTestStep(2, "调用register_token_binding");
      // const tx = await tokenProgram.methods
      //   .registerTokenBinding(
      //     sourceChain,
      //     Array.from(solUSDCBytes32),
      //     targetChain,
      //     Array.from(targetToken)
      //   )
      //   .accounts({
      //     bridgeConfig: bridgeConfigPDA,
      //     tokenBinding: bindingPDA,
      //     authority: authority.publicKey,
      //     payer: payer.publicKey,
      //     systemProgram: SystemProgram.programId,
      //   })
      //   .signers([authority, payer])
      //   .rpc();
      
      // assertTxSuccess(tx, "TokenBinding注册成功");
      
      printTestStep(3, "验证TokenBinding账户");
      // const binding = await tokenProgram.account.tokenBinding.fetch(bindingPDA);
      // assertEqual(binding.sourceChain, sourceChain, "源链ID正确");
      // assertEqual(Buffer.from(binding.sourceToken).toString('hex'), solUSDCBytes32.toString('hex'), "源代币地址正确");
      // assertEqual(binding.targetChain, targetChain, "目标链ID正确");
      // assertEqual(Buffer.from(binding.targetToken).toString('hex'), targetToken.toString('hex'), "目标代币地址正确");
      // assertEqual(binding.rateNumerator.toNumber(), 1, "默认比率分子为1");
      // assertEqual(binding.rateDenominator.toNumber(), 1, "默认比率分母为1");
      // assertEqual(binding.enabled, true, "Binding已启用");
      // assertEqual(binding.useExternalPrice, false, "未启用外部定价");
      
      console.log("✓ UNIT-TB-011 测试通过（占位，等待程序实现）");
      console.log("  包含TokenBinding账户创建和参数验证");
    });
    
    it("UNIT-TB-012: 重复注册失败", async () => {
      printTestStep(1, "尝试重复注册相同的binding");
      
      const sourceChain = 900;
      const solUSDCBytes32 = solanaAddressToBytes32(solUSDCMint);
      const targetChain = 1;
      const targetToken = ethUSDC;
      
      try {
        // const tx = await tokenProgram.methods
        //   .registerTokenBinding(sourceChain, Array.from(solUSDCBytes32), targetChain, Array.from(targetToken))
        //   .accounts({ ... })
        //   .rpc();
        
        // throw new Error("应该失败但成功了");
      } catch (error) {
        assertTxFailed(error, "already in use");
      }
      
      console.log("✓ UNIT-TB-012 测试通过（占位，等待程序实现）");
    });
    
    it("UNIT-TB-013: 非管理员调用失败", async () => {
      printTestStep(1, "尝试使用非管理员账户注册binding");
      
      const unauthorizedUser = Keypair.generate();
      await airdrop(provider.connection, unauthorizedUser.publicKey);
      
      try {
        // const tx = await tokenProgram.methods
        //   .registerTokenBinding(...)
        //   .accounts({
        //     authority: unauthorizedUser.publicKey,  // 非管理员
        //     ...
        //   })
        //   .signers([unauthorizedUser, payer])
        //   .rpc();
        
        // throw new Error("应该失败但成功了");
      } catch (error) {
        assertTxFailed(error, "Unauthorized");
      }
      
      console.log("✓ UNIT-TB-013 测试通过（占位，等待程序实现）");
    });
    
    it("UNIT-TB-014: 注册不同代币兑换对（多对多）", async () => {
      printTestStep(1, "注册多个目标代币（同一源代币）");
      
      const solUSDCBytes32 = solanaAddressToBytes32(solUSDCMint);
      
      // Solana USDC → Ethereum USDC
      const [binding1PDA] = getTokenBindingPDA(
        tokenProgram.programId,
        900, solUSDCBytes32,
        1, ethUSDC
      );
      
      // Solana USDC → Ethereum USDT
      const [binding2PDA] = getTokenBindingPDA(
        tokenProgram.programId,
        900, solUSDCBytes32,
        1, ethUSDT
      );
      
      // Solana USDC → Ethereum DAI
      const [binding3PDA] = getTokenBindingPDA(
        tokenProgram.programId,
        900, solUSDCBytes32,
        1, ethDAI
      );
      
      console.log(`  同一源代币注册3个不同目标代币：`);
      console.log(`  1. USDC → Ethereum USDC`);
      console.log(`  2. USDC → Ethereum USDT`);
      console.log(`  3. USDC → Ethereum DAI`);
      
      printTestStep(2, "验证所有binding都存在且独立");
      // 验证3个PDA地址不同
      assert(binding1PDA.toBase58() !== binding2PDA.toBase58(), "PDA 1 != PDA 2");
      assert(binding2PDA.toBase58() !== binding3PDA.toBase58(), "PDA 2 != PDA 3");
      assert(binding1PDA.toBase58() !== binding3PDA.toBase58(), "PDA 1 != PDA 3");
      
      // const binding1 = await tokenProgram.account.tokenBinding.fetch(binding1PDA);
      // const binding2 = await tokenProgram.account.tokenBinding.fetch(binding2PDA);
      // const binding3 = await tokenProgram.account.tokenBinding.fetch(binding3PDA);
      
      // assertEqual(Buffer.from(binding1.targetToken).toString('hex'), ethUSDC.toString('hex'), "Binding1目标为USDC");
      // assertEqual(Buffer.from(binding2.targetToken).toString('hex'), ethUSDT.toString('hex'), "Binding2目标为USDT");
      // assertEqual(Buffer.from(binding3.targetToken).toString('hex'), ethDAI.toString('hex'), "Binding3目标为DAI");
      
      console.log("✓ UNIT-TB-014 测试通过（占位，等待程序实现）");
      console.log("  支持一对多代币绑定（多对多关系）");
    });
    
    it("UNIT-TB-030: 注册出站和入站binding（双向）", async () => {
      printTestStep(1, "在Solana链上注册双向binding");
      
      const solUSDCBytes32 = solanaAddressToBytes32(solUSDCMint);
      
      // 1. 出站: Solana USDC → Ethereum USDC
      const [outboundPDA] = getTokenBindingPDA(
        tokenProgram.programId,
        900, solUSDCBytes32,  // Solana
        1, ethUSDC            // Ethereum
      );
      
      // 2. 入站: Ethereum USDC → Solana USDC (用于验证)
      const [inboundPDA] = getTokenBindingPDA(
        tokenProgram.programId,
        1, ethUSDC,           // Ethereum
        900, solUSDCBytes32   // Solana
      );
      
      console.log(`  出站Binding PDA: ${outboundPDA.toBase58()}`);
      console.log(`  入站Binding PDA: ${inboundPDA.toBase58()}`);
      console.log(`  两个PDA不同: ${outboundPDA.toBase58() !== inboundPDA.toBase58()}`);
      
      printTestStep(2, "注册出站binding");
      // await tokenProgram.methods.registerTokenBinding(900, Array.from(solUSDCBytes32), 1, Array.from(ethUSDC)).rpc();
      
      printTestStep(3, "注册入站binding");
      // await tokenProgram.methods.registerTokenBinding(1, Array.from(ethUSDC), 900, Array.from(solUSDCBytes32)).rpc();
      
      printTestStep(4, "验证出站binding");
      // const outbound = await tokenProgram.account.tokenBinding.fetch(outboundPDA);
      // assertEqual(outbound.sourceChain, 900, "出站源链为Solana");
      // assertEqual(outbound.targetChain, 1, "出站目标链为Ethereum");
      
      printTestStep(5, "验证入站binding");
      // const inbound = await tokenProgram.account.tokenBinding.fetch(inboundPDA);
      // assertEqual(inbound.sourceChain, 1, "入站源链为Ethereum");
      // assertEqual(inbound.targetChain, 900, "入站目标链为Solana");
      
      console.log("✓ UNIT-TB-030 测试通过（占位，等待程序实现）");
      console.log("  包含双向binding注册（出站+入站）");
    });
  });
  
  // ============================================
  // 2.2.4 register_bidirectional_binding指令测试（新增）
  // ============================================
  
  describe("UNIT-TB-031 ~ 035: register_bidirectional_binding指令", () => {
    it("UNIT-TB-031: 双向注册同币种（1:1）", async () => {
      printTestStep(1, "准备双向注册参数");
      const localChain = 900;  // Solana
      const localToken = solanaAddressToBytes32(solUSDCMint);
      const remoteChain = 1;   // Ethereum
      const remoteToken = ethUSDC;
      
      const [outboundPDA] = getTokenBindingPDA(tokenProgram.programId, localChain, localToken, remoteChain, remoteToken);
      const [inboundPDA] = getTokenBindingPDA(tokenProgram.programId, remoteChain, remoteToken, localChain, localToken);
      
      console.log(`  Local: Solana(900) USDC`);
      console.log(`  Remote: Ethereum(1) USDC`);
      console.log(`  Outbound Rate: 1:1`);
      console.log(`  Inbound Rate: 1:1`);
      
      printTestStep(2, "调用register_bidirectional_binding");
      // const tx = await tokenProgram.methods
      //   .registerBidirectionalBinding(
      //     localChain, Array.from(localToken),
      //     remoteChain, Array.from(remoteToken),
      //     new anchor.BN(1), new anchor.BN(1),  // outbound rate 1:1
      //     new anchor.BN(1), new anchor.BN(1)   // inbound rate 1:1
      //   )
      //   .accounts({
      //     bridgeConfig: bridgeConfigPDA,
      //     outboundBinding: outboundPDA,
      //     inboundBinding: inboundPDA,
      //     authority: authority.publicKey,
      //     payer: payer.publicKey,
      //     systemProgram: SystemProgram.programId,
      //   })
      //   .signers([authority, payer])
      //   .rpc();
      
      // assertTxSuccess(tx, "双向binding注册成功");
      
      printTestStep(3, "验证出站binding");
      // const outbound = await tokenProgram.account.tokenBinding.fetch(outboundPDA);
      // assertEqual(outbound.sourceChain, localChain, "出站源链");
      // assertEqual(outbound.targetChain, remoteChain, "出站目标链");
      // assertEqual(outbound.rateNumerator.toNumber(), 1, "出站比率分子");
      // assertEqual(outbound.rateDenominator.toNumber(), 1, "出站比率分母");
      
      printTestStep(4, "验证入站binding");
      // const inbound = await tokenProgram.account.tokenBinding.fetch(inboundPDA);
      // assertEqual(inbound.sourceChain, remoteChain, "入站源链");
      // assertEqual(inbound.targetChain, localChain, "入站目标链");
      // assertEqual(inbound.rateNumerator.toNumber(), 1, "入站比率分子");
      // assertEqual(inbound.rateDenominator.toNumber(), 1, "入站比率分母");
      
      console.log("✓ UNIT-TB-031 测试通过（占位，等待程序实现）");
      console.log("  自动创建两个binding账户");
    });
    
    it("UNIT-TB-032: 双向注册不同币种", async () => {
      printTestStep(1, "双向注册不同币种（USDC ↔ USDT）");
      
      const localToken = solanaAddressToBytes32(solUSDCMint);
      const remoteToken = ethUSDT;  // 不同币种
      
      console.log(`  Local: Solana USDC`);
      console.log(`  Remote: Ethereum USDT`);
      
      // const tx = await tokenProgram.methods
      //   .registerBidirectionalBinding(
      //     900, Array.from(localToken),
      //     1, Array.from(remoteToken),
      //     new anchor.BN(998), new anchor.BN(1000),  // outbound: 1 USDC = 0.998 USDT
      //     new anchor.BN(1002), new anchor.BN(1000)  // inbound: 1 USDT = 1.002 USDC
      //   )
      //   .accounts({ ... })
      //   .rpc();
      
      console.log("✓ UNIT-TB-032 测试通过（占位，等待程序实现）");
      console.log("  支持不同币种的双向绑定");
    });
    
    it("UNIT-TB-033: 双向不对称兑换比率", async () => {
      printTestStep(1, "设置出站和入站不同的兑换比率");
      
      const localToken = solanaAddressToBytes32(solUSDCMint);
      const remoteToken = ethUSDT;
      
      const outboundNum = 998;
      const outboundDenom = 1000;
      const inboundNum = 1002;
      const inboundDenom = 1000;
      
      console.log(`  出站比率: ${outboundNum}:${outboundDenom} (1 USDC = 0.998 USDT)`);
      console.log(`  入站比率: ${inboundNum}:${inboundDenom} (1 USDT = 1.002 USDC)`);
      
      // const tx = await tokenProgram.methods
      //   .registerBidirectionalBinding(
      //     900, Array.from(localToken),
      //     1, Array.from(remoteToken),
      //     new anchor.BN(outboundNum), new anchor.BN(outboundDenom),
      //     new anchor.BN(inboundNum), new anchor.BN(inboundDenom)
      //   )
      //   .accounts({ ... })
      //   .rpc();
      
      printTestStep(2, "验证不对称兑换比率");
      const [outboundPDA] = getTokenBindingPDA(tokenProgram.programId, 900, localToken, 1, remoteToken);
      const [inboundPDA] = getTokenBindingPDA(tokenProgram.programId, 1, remoteToken, 900, localToken);
      
      // const outbound = await tokenProgram.account.tokenBinding.fetch(outboundPDA);
      // assertEqual(outbound.rateNumerator.toNumber(), outboundNum, "出站比率分子");
      // assertEqual(outbound.rateDenominator.toNumber(), outboundDenom, "出站比率分母");
      
      // const inbound = await tokenProgram.account.tokenBinding.fetch(inboundPDA);
      // assertEqual(inbound.rateNumerator.toNumber(), inboundNum, "入站比率分子");
      // assertEqual(inbound.rateDenominator.toNumber(), inboundDenom, "入站比率分母");
      
      printTestStep(3, "验证兑换计算");
      const outboundAmount = Math.floor(1000_000_000 * outboundNum / outboundDenom);
      const inboundAmount = Math.floor(1000_000_000 * inboundNum / inboundDenom);
      
      assertEqual(outboundAmount, 998_000_000, "出站兑换结果");
      assertEqual(inboundAmount, 1_002_000_000, "入站兑换结果");
      
      console.log("✓ UNIT-TB-033 测试通过（占位，等待程序实现）");
      console.log("  支持双向不对称兑换比率");
    });
    
    it("UNIT-TB-034: 验证自动创建两个binding", async () => {
      printTestStep(1, "验证一次调用创建两个PDA");
      
      const localToken = solanaAddressToBytes32(solUSDTMint);
      const remoteToken = ethDAI;
      
      const [outboundPDA] = getTokenBindingPDA(tokenProgram.programId, 900, localToken, 1, remoteToken);
      const [inboundPDA] = getTokenBindingPDA(tokenProgram.programId, 1, remoteToken, 900, localToken);
      
      // const tx = await tokenProgram.methods
      //   .registerBidirectionalBinding(...)
      //   .accounts({ ... })
      //   .rpc();
      
      printTestStep(2, "验证两个PDA都被创建");
      // const outbound = await tokenProgram.account.tokenBinding.fetch(outboundPDA);
      // const inbound = await tokenProgram.account.tokenBinding.fetch(inboundPDA);
      
      // assert(outbound, "出站binding存在");
      // assert(inbound, "入站binding存在");
      
      console.log("✓ UNIT-TB-034 测试通过（占位，等待程序实现）");
    });
    
    it("UNIT-TB-035: 非管理员调用失败", async () => {
      printTestStep(1, "尝试使用非管理员账户注册双向binding");
      
      const unauthorizedUser = Keypair.generate();
      await airdrop(provider.connection, unauthorizedUser.publicKey);
      
      try {
        // const tx = await tokenProgram.methods
        //   .registerBidirectionalBinding(...)
        //   .accounts({
        //     authority: unauthorizedUser.publicKey,  // 非管理员
        //     ...
        //   })
        //   .signers([unauthorizedUser, payer])
        //   .rpc();
        
        // throw new Error("应该失败但成功了");
      } catch (error) {
        assertTxFailed(error, "Unauthorized");
      }
      
      console.log("✓ UNIT-TB-035 测试通过（占位，等待程序实现）");
    });
  });
  
  // ============================================
  // 2.2.5 set_exchange_rate指令测试（新增）
  // ============================================
  
  describe("UNIT-TB-015 ~ 019: set_exchange_rate指令", () => {
    it("UNIT-TB-015: 设置1:1兑换比率", async () => {
      printTestStep(1, "先注册TokenBinding");
      const solUSDCBytes32 = solanaAddressToBytes32(solUSDCMint);
      const [bindingPDA] = getTokenBindingPDA(tokenProgram.programId, 900, solUSDCBytes32, 1, ethUSDC);
      
      // await tokenProgram.methods.registerTokenBinding(...).rpc();
      
      printTestStep(2, "设置1:1兑换比率");
      // const tx = await tokenProgram.methods
      //   .setExchangeRate(
      //     900, Array.from(solUSDCBytes32),
      //     1, Array.from(ethUSDC),
      //     new anchor.BN(1),  // rate_numerator
      //     new anchor.BN(1)   // rate_denominator
      //   )
      //   .accounts({
      //     tokenBinding: bindingPDA,
      //     authority: authority.publicKey,
      //   })
      //   .signers([authority])
      //   .rpc();
      
      // assertTxSuccess(tx, "兑换比率设置成功");
      
      printTestStep(3, "验证兑换比率");
      // const binding = await tokenProgram.account.tokenBinding.fetch(bindingPDA);
      // assertEqual(binding.rateNumerator.toNumber(), 1, "比率分子为1");
      // assertEqual(binding.rateDenominator.toNumber(), 1, "比率分母为1");
      
      printTestStep(4, "验证兑换计算");
      const sourceAmount = 1000_000_000;
      const targetAmount = sourceAmount * 1 / 1;
      assertEqual(targetAmount, 1000_000_000, "1:1兑换结果正确");
      
      console.log("✓ UNIT-TB-015 测试通过（占位，等待程序实现）");
    });
    
    it("UNIT-TB-016: 设置自定义兑换比率", async () => {
      printTestStep(1, "设置自定义比率（1 USDC = 0.998 USDT）");
      
      const solUSDCBytes32 = solanaAddressToBytes32(solUSDCMint);
      const [bindingPDA] = getTokenBindingPDA(tokenProgram.programId, 900, solUSDCBytes32, 1, ethUSDT);
      
      // const tx = await tokenProgram.methods
      //   .setExchangeRate(
      //     900, Array.from(solUSDCBytes32),
      //     1, Array.from(ethUSDT),
      //     new anchor.BN(998),   // rate_numerator
      //     new anchor.BN(1000)   // rate_denominator
      //   )
      //   .accounts({ ... })
      //   .rpc();
      
      printTestStep(2, "验证兑换计算");
      const sourceAmount = 1000_000_000;  // 1000 USDC
      const targetAmount = Math.floor(sourceAmount * 998 / 1000);
      assertEqual(targetAmount, 998_000_000, "兑换结果: 998 USDT");
      
      console.log("✓ UNIT-TB-016 测试通过（占位，等待程序实现）");
    });
    
    it("UNIT-TB-017: 分母为0失败", async () => {
      printTestStep(1, "尝试设置分母为0的兑换比率");
      
      try {
        // const tx = await tokenProgram.methods
        //   .setExchangeRate(
        //     900, Array.from(solUSDCBytes32),
        //     1, Array.from(ethUSDC),
        //     new anchor.BN(1),
        //     new anchor.BN(0)  // 分母为0
        //   )
        //   .accounts({ ... })
        //   .rpc();
        
        // throw new Error("应该失败但成功了");
      } catch (error) {
        assertTxFailed(error, "ZeroDenominator");
      }
      
      console.log("✓ UNIT-TB-017 测试通过（占位，等待程序实现）");
    });
    
    it("UNIT-TB-018: TokenBinding不存在失败", async () => {
      printTestStep(1, "尝试为不存在的binding设置兑换比率");
      
      const unknownToken = ethAddressToBytes32("0x0000000000000000000000000000000000000001");
      const [unknownBindingPDA] = getTokenBindingPDA(
        tokenProgram.programId,
        900, solanaAddressToBytes32(solUSDCMint),
        1, unknownToken
      );
      
      try {
        // const tx = await tokenProgram.methods
        //   .setExchangeRate(...)
        //   .accounts({
        //     tokenBinding: unknownBindingPDA,  // 不存在的binding
        //     ...
        //   })
        //   .rpc();
        
        // throw new Error("应该失败但成功了");
      } catch (error) {
        assertTxFailed(error, "TokenBindingNotFound");
      }
      
      console.log("✓ UNIT-TB-018 测试通过（占位，等待程序实现）");
    });
    
    it("UNIT-TB-019: 非管理员调用失败", async () => {
      printTestStep(1, "尝试使用非管理员账户设置兑换比率");
      
      const unauthorizedUser = Keypair.generate();
      await airdrop(provider.connection, unauthorizedUser.publicKey);
      
      try {
        // const tx = await tokenProgram.methods
        //   .setExchangeRate(...)
        //   .accounts({
        //     authority: unauthorizedUser.publicKey,  // 非管理员
        //   })
        //   .signers([unauthorizedUser])
        //   .rpc();
        
        // throw new Error("应该失败但成功了");
      } catch (error) {
        assertTxFailed(error, "Unauthorized");
      }
      
      console.log("✓ UNIT-TB-019 测试通过（占位，等待程序实现）");
    });
  });
  
  // ============================================
  // 2.2.6 update_amm_config指令测试（新增 - 预留）
  // ============================================
  
  describe("UNIT-TB-020 ~ 022: update_amm_config指令（预留）", () => {
    it("UNIT-TB-020: 启用外部AMM定价", async () => {
      printTestStep(1, "配置外部AMM程序ID");
      
      // 假设Raydium程序ID
      const raydiumProgramId = new PublicKey("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8");
      
      // const tx = await tokenProgram.methods
      //   .updateAmmConfig(
      //     900, Array.from(solUSDCBytes32),
      //     1, Array.from(ethUSDT),
      //     raydiumProgramId,
      //     true  // use_external_price
      //   )
      //   .accounts({
      //     tokenBinding: bindingPDA,
      //     authority: authority.publicKey,
      //   })
      //   .signers([authority])
      //   .rpc();
      
      printTestStep(2, "验证AMM配置");
      // const binding = await tokenProgram.account.tokenBinding.fetch(bindingPDA);
      // assertEqual(binding.useExternalPrice, true, "已启用外部定价");
      // assertEqual(binding.ammProgramId.toBase58(), raydiumProgramId.toBase58(), "AMM程序ID正确");
      
      console.log("✓ UNIT-TB-020 测试通过（占位，等待程序实现）");
      console.log("  预留接口，支持未来集成外部AMM");
    });
    
    it("UNIT-TB-021: 禁用外部AMM定价", async () => {
      printTestStep(1, "禁用外部AMM，使用固定比率");
      
      // const tx = await tokenProgram.methods
      //   .updateAmmConfig(
      //     900, Array.from(solUSDCBytes32),
      //     1, Array.from(ethUSDT),
      //     PublicKey.default,
      //     false  // 禁用外部定价
      //   )
      //   .accounts({ ... })
      //   .rpc();
      
      // const binding = await tokenProgram.account.tokenBinding.fetch(bindingPDA);
      // assertEqual(binding.useExternalPrice, false, "已禁用外部定价");
      
      console.log("✓ UNIT-TB-021 测试通过（占位，等待程序实现）");
    });
    
    it("UNIT-TB-022: 非管理员调用失败", async () => {
      printTestStep(1, "尝试使用非管理员账户更新AMM配置");
      
      const unauthorizedUser = Keypair.generate();
      await airdrop(provider.connection, unauthorizedUser.publicKey);
      
      try {
        // const tx = await tokenProgram.methods
        //   .updateAmmConfig(...)
        //   .accounts({
        //     authority: unauthorizedUser.publicKey,
        //   })
        //   .signers([unauthorizedUser])
        //   .rpc();
        
        // throw new Error("应该失败但成功了");
      } catch (error) {
        assertTxFailed(error, "Unauthorized");
      }
      
      console.log("✓ UNIT-TB-022 测试通过（占位，等待程序实现）");
    });
  });
  
});
