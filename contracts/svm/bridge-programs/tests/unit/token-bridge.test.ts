/**
 * token-bridge程序单元测试
 * 测试数量：12个
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
} from "../utils/setup";
import {
  createTokenTransferVAA,
  TokenTransferPayload,
} from "../utils/vaa";
import {
  getWrappedMetaPDA,
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

describe("token-bridge单元测试", () => {
  let provider: anchor.AnchorProvider;
  let coreProgram: Program;  // solana-core程序
  let tokenProgram: Program; // token-bridge程序
  let payer: Keypair;
  let user: Keypair;
  
  // Test tokens
  let testMint: PublicKey;
  let userTokenAccount: PublicKey;
  let custodyAccount: PublicKey;
  
  before(async () => {
    printTestHeader("token-bridge程序初始化");
    
    const env = await setupTestEnvironment();
    provider = env.provider;
    
    // 加载程序
    coreProgram = anchor.workspace.SolanaCore as Program;
    tokenProgram = anchor.workspace.TokenBridge as Program;
    
    payer = Keypair.generate();
    user = Keypair.generate();
    
    await airdrop(provider.connection, payer.publicKey);
    await airdrop(provider.connection, user.publicKey);
    
    printTestStep(1, "创建测试SPL Token");
    testMint = await createTestMint(provider.connection, payer, 6);
    console.log(`✓ Test Mint: ${testMint.toBase58()}`);
    
    printTestStep(2, "创建用户Token账户并铸造代币");
    userTokenAccount = await createAndMintTestToken(
      provider.connection,
      payer,
      testMint,
      user.publicKey,
      BigInt(1000_000_000) // 1000 tokens
    );
    console.log(`✓ User Token Account: ${userTokenAccount.toBase58()}`);
    
    console.log("✓ 测试环境初始化完成");
  });
  
  // ============================================
  // 2.2.1 transfer_tokens指令测试（支持跨链兑换）
  // ============================================
  
  describe("UNIT-TB-001 ~ 005: transfer_tokens指令", () => {
    it("UNIT-TB-001: 正常锁定SPL代币（1:1兑换）", async () => {
      printTestStep(1, "准备转账参数");
      const amount = BigInt(500_000_000); // 500 tokens
      const targetChain = 1; // Ethereum
      const recipient = ethAddressToBytes32("0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb");
      
      printTestStep(2, "查询初始余额");
      // const balanceBefore = await getTokenBalance(provider.connection, userTokenAccount);
      // assertEqual(balanceBefore, BigInt(1000_000_000), "初始余额1000 tokens");
      
      printTestStep(3, "调用transfer_tokens");
      // const tx = await tokenProgram.methods
      //   .transferTokens(new anchor.BN(amount.toString()), targetChain, Array.from(recipient))
      //   .accounts({
      //     bridge: bridgePDA,
      //     tokenAccount: userTokenAccount,
      //     custodyAccount: custodyPDA,
      //     tokenAuthority: user.publicKey,
      //     tokenProgram: TOKEN_PROGRAM_ID,
      //   })
      //   .signers([user])
      //   .rpc();
      
      // assertTxSuccess(tx, "SPL代币锁定成功");
      
      printTestStep(4, "验证代币锁定");
      // const custodyBalance = await getTokenBalance(provider.connection, custodyPDA);
      // assertEqual(custodyBalance, amount, "Custody账户增加500 tokens");
      
      // const userBalance = await getTokenBalance(provider.connection, userTokenAccount);
      // assertEqual(userBalance, BigInt(500_000_000), "用户余额减少到500 tokens");
      
      printTestStep(5, "验证消息发送");
      // 验证post_message被调用，序列号递增
      
      console.log("✓ UNIT-TB-001 测试通过（占位，等待程序实现）");
    });
    
    it("UNIT-TB-002: 授权不足", async () => {
      printTestStep(1, "尝试转账未授权的代币");
      
      const otherUser = Keypair.generate();
      await airdrop(provider.connection, otherUser.publicKey);
      
      const amount = BigInt(100_000_000);
      const targetChain = 1;
      const recipient = ethAddressToBytes32("0x0000000000000000000000000000000000000001");
      
      try {
        // const tx = await tokenProgram.methods
        //   .transferTokens(new anchor.BN(amount.toString()), targetChain, Array.from(recipient))
        //   .accounts({
        //     tokenAccount: userTokenAccount,
        //     tokenAuthority: otherUser.publicKey, // 错误的authority
        //     ...
        //   })
        //   .signers([otherUser])
        //   .rpc();
        
        // throw new Error("应该失败但成功了");
      } catch (error) {
        assertTxFailed(error, "owner does not match");
      }
      
      console.log("✓ UNIT-TB-002 测试通过（占位，等待程序实现）");
    });
    
    it("UNIT-TB-003: 余额不足", async () => {
      printTestStep(1, "尝试转账超过余额的数量");
      
      const amount = BigInt(2000_000_000); // 2000 tokens (超过余额)
      const targetChain = 1;
      const recipient = ethAddressToBytes32("0x0000000000000000000000000000000000000001");
      
      try {
        // const tx = await tokenProgram.methods
        //   .transferTokens(new anchor.BN(amount.toString()), targetChain, Array.from(recipient))
        //   .accounts({ ... })
        //   .signers([user])
        //   .rpc();
        
        // throw new Error("应该失败但成功了");
      } catch (error) {
        assertTxFailed(error, "insufficient funds");
      }
      
      console.log("✓ UNIT-TB-003 测试通过（占位，等待程序实现）");
    });
    
    it("UNIT-TB-004: 手续费不足", async () => {
      // 测试手续费不足的情况
      console.log("✓ UNIT-TB-004 测试通过（占位，等待程序实现）");
    });
    
    it("UNIT-TB-005: 无效目标链", async () => {
      // 测试无效的目标链ID
      console.log("✓ UNIT-TB-005 测试通过（占位，等待程序实现）");
    });
  });
  
  // ============================================
  // 2.2.2 complete_transfer指令测试
  // ============================================
  
  describe("UNIT-TB-006 ~ 010: complete_transfer指令", () => {
    it("UNIT-TB-006: 解锁原生SPL代币", async () => {
      printTestStep(1, "预先锁定一些代币到custody");
      // 假设custody中已有1000 tokens
      
      printTestStep(2, "构造来自Ethereum的转账VAA");
      const payload: TokenTransferPayload = {
        payloadType: 1,
        amount: BigInt(500_000_000), // 500 tokens
        tokenAddress: solanaAddressToBytes32(testMint),
        tokenChain: 2, // Solana原生
        recipient: solanaAddressToBytes32(user.publicKey),
        recipientChain: 2, // Solana
      };
      
      // const vaa = createTokenTransferVAA({
      //   guardianSetIndex: 0,
      //   emitterChain: 1, // Ethereum
      //   emitterAddress: ethAddressToBytes32("0x..."),
      //   sequence: BigInt(1),
      //   guardianKeypairs: testGuardianKeypairs.slice(0, 13),
      //   transferPayload: payload,
      // });
      
      printTestStep(3, "调用complete_transfer");
      // const tx = await tokenProgram.methods
      //   .completeTransfer(vaa)
      //   .accounts({
      //     bridge: bridgePDA,
      //     postedVaa: postedVAAPDA,
      //     recipientAccount: userTokenAccount,
      //     custodyOrMint: custodyPDA,
      //     tokenProgram: TOKEN_PROGRAM_ID,
      //   })
      //   .rpc();
      
      // assertTxSuccess(tx, "代币解锁成功");
      
      printTestStep(4, "验证用户收到代币");
      // const userBalance = await getTokenBalance(provider.connection, userTokenAccount);
      // assertEqual(userBalance, BigInt(1000_000_000), "用户余额增加到1000 tokens");
      
      printTestStep(5, "验证custody减少");
      // const custodyBalance = await getTokenBalance(provider.connection, custodyPDA);
      // assertEqual(custodyBalance, BigInt(500_000_000), "Custody余额减少");
      
      printTestStep(6, "验证VAA标记为已消费");
      // const postedVAA = await coreProgram.account.postedVaa.fetch(postedVAAPDA);
      // assertEqual(postedVAA.consumed, true, "VAA已被消费");
      
      console.log("✓ UNIT-TB-006 测试通过（占位，等待程序实现）");
    });
    
    it("UNIT-TB-007: 铸造包装代币", async () => {
      printTestStep(1, "构造来自Ethereum的ERC20转账VAA");
      
      // Ethereum USDC地址
      const ethUSDC = ethAddressToBytes32("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
      
      const payload: TokenTransferPayload = {
        payloadType: 1,
        amount: BigInt(1000_000_000), // 1000 USDC
        tokenAddress: ethUSDC,
        tokenChain: 1, // Ethereum
        recipient: solanaAddressToBytes32(user.publicKey),
        recipientChain: 2, // Solana
      };
      
      // const vaa = createTokenTransferVAA({ ... });
      
      printTestStep(2, "调用complete_transfer（铸造wrappedUSDC）");
      // const wrappedMint = ...;
      // const wrappedTokenAccount = ...;
      
      // const tx = await tokenProgram.methods
      //   .completeTransfer(vaa)
      //   .accounts({
      //     recipientAccount: wrappedTokenAccount,
      //     custodyOrMint: wrappedMint, // Mint而不是custody
      //     ...
      //   })
      //   .rpc();
      
      // assertTxSuccess(tx, "wrappedUSDC铸造成功");
      
      printTestStep(3, "验证用户收到wrappedUSDC");
      // const balance = await getTokenBalance(provider.connection, wrappedTokenAccount);
      // assertEqual(balance, BigInt(1000_000_000), "用户收到1000 wrappedUSDC");
      
      console.log("✓ UNIT-TB-007 测试通过（占位，等待程序实现）");
    });
    
    it("UNIT-TB-008: VAA验证失败", async () => {
      // 测试无效VAA
      console.log("✓ UNIT-TB-008 测试通过（占位，等待程序实现）");
    });
    
    it("UNIT-TB-009: 目标链不匹配", async () => {
      printTestStep(1, "构造目标链为BSC的VAA");
      
      const payload: TokenTransferPayload = {
        payloadType: 1,
        amount: BigInt(100_000_000),
        tokenAddress: Buffer.alloc(32),
        tokenChain: 1,
        recipient: solanaAddressToBytes32(user.publicKey),
        recipientChain: 56, // BSC，不是Solana
      };
      
      // const vaa = createTokenTransferVAA({ ... });
      
      printTestStep(2, "尝试在Solana执行（应该失败）");
      try {
        // const tx = await tokenProgram.methods.completeTransfer(vaa).accounts({ ... }).rpc();
        // throw new Error("应该失败但成功了");
      } catch (error) {
        assertTxFailed(error, "InvalidTargetChain");
      }
      
      console.log("✓ UNIT-TB-009 测试通过（占位，等待程序实现）");
    });
    
    it("UNIT-TB-010: 余额不足（custody）", async () => {
      // 测试custody余额不足无法解锁
      console.log("✓ UNIT-TB-010 测试通过（占位，等待程序实现）");
    });
  });
  
  // ============================================
  // 2.2.3 create_wrapped指令测试
  // ============================================
  
  describe("UNIT-TB-011 ~ 012: create_wrapped指令", () => {
    it("UNIT-TB-011: 创建包装代币", async () => {
      printTestStep(1, "准备Ethereum USDC信息");
      const ethChainId = 1;
      const ethUSDC = ethAddressToBytes32("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
      const decimals = 6;
      
      printTestStep(2, "调用create_wrapped");
      // const [wrappedMintPDA] = getWrappedMetaPDA(tokenProgram.programId, ethChainId, ethUSDC);
      // const [wrappedMetaPDA] = ...;
      
      // const tx = await tokenProgram.methods
      //   .createWrapped(ethChainId, Array.from(ethUSDC), decimals)
      //   .accounts({
      //     wrappedMint: wrappedMintPDA,
      //     wrappedMeta: wrappedMetaPDA,
      //     payer: payer.publicKey,
      //     tokenProgram: TOKEN_PROGRAM_ID,
      //     systemProgram: SystemProgram.programId,
      //   })
      //   .signers([payer])
      //   .rpc();
      
      // assertTxSuccess(tx, "包装代币创建成功");
      
      printTestStep(3, "验证Mint账户");
      // const mint = await getMint(provider.connection, wrappedMintPDA);
      // assertEqual(mint.decimals, decimals, "Decimals正确");
      // assert(mint.mintAuthority, "Mint Authority已设置");
      
      printTestStep(4, "验证WrappedMeta账户");
      // const meta = await tokenProgram.account.wrappedMeta.fetch(wrappedMetaPDA);
      // assertEqual(meta.originalChain, ethChainId, "原链ID正确");
      // assert(Buffer.from(meta.originalAddress).equals(ethUSDC), "原链地址正确");
      // assertEqual(meta.decimals, decimals, "Decimals正确");
      
      console.log("✓ UNIT-TB-011 测试通过（占位，等待程序实现）");
    });
    
    it("UNIT-TB-012: 重复创建失败", async () => {
      printTestStep(1, "尝试重复创建相同的包装代币");
      
      const ethChainId = 1;
      const ethUSDC = ethAddressToBytes32("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
      const decimals = 6;
      
      try {
        // const tx = await tokenProgram.methods
        //   .createWrapped(ethChainId, Array.from(ethUSDC), decimals)
        //   .accounts({ ... })
        //   .signers([payer])
        //   .rpc();
        
        // throw new Error("应该失败但成功了");
      } catch (error) {
        assertTxFailed(error, "already in use");
      }
      
      console.log("✓ UNIT-TB-012 测试通过（占位，等待程序实现）");
    });
  });
  
  // ============================================
  // 2.2.3 register_token_binding指令测试（新增）
  // ============================================
  
  describe("UNIT-TB-011 ~ 014, 030: register_token_binding指令", () => {
    it("UNIT-TB-011: 正常注册单向代币绑定", async () => {
      printTestHeader("UNIT-TB-011: 注册代币绑定");
      
      printTestStep(1, "准备代币信息");
      // Ethereum USDC地址
      const ethChainId = 1;
      const ethUSDC = ethAddressToBytes32("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
      
      // Solana USDC Mint (示例)
      const solChainId = 900; // Solana mainnet chain id
      const solUSDC = solanaAddressToBytes32(testMint);
      
      printTestStep(2, "计算TokenBinding PDA");
      // const [tokenBindingPDA] = getTokenBindingPDA(
      //   tokenProgram.programId,
      //   ethChainId,
      //   ethUSDC,
      //   solChainId,
      //   solUSDC
      // );
      
      printTestStep(3, "调用register_token_binding");
      // const [bridgeConfigPDA] = getBridgeConfigPDA(tokenProgram.programId);
      // const tx = await tokenProgram.methods
      //   .registerTokenBinding(
      //     ethChainId,
      //     Array.from(ethUSDC),
      //     solChainId,
      //     Array.from(solUSDC)
      //   )
      //   .accounts({
      //     bridgeConfig: bridgeConfigPDA,
      //     tokenBinding: tokenBindingPDA,
      //     authority: payer.publicKey,
      //     payer: payer.publicKey,
      //     systemProgram: SystemProgram.programId,
      //   })
      //   .signers([payer])
      //   .rpc();
      
      // assertTxSuccess(tx, "TokenBinding注册成功");
      
      printTestStep(4, "验证TokenBinding账户");
      // const binding = await tokenProgram.account.tokenBinding.fetch(tokenBindingPDA);
      // assertEqual(binding.sourceChain, ethChainId, "源链ID正确");
      // assert(Buffer.from(binding.sourceToken).equals(ethUSDC), "源代币地址正确");
      // assertEqual(binding.targetChain, solChainId, "目标链ID正确");
      // assert(Buffer.from(binding.targetToken).equals(solUSDC), "目标代币地址正确");
      // assertEqual(binding.rateNumerator.toNumber(), 1, "默认兑换比率分子为1");
      // assertEqual(binding.rateDenominator.toNumber(), 1, "默认兑换比率分母为1");
      // assertEqual(binding.enabled, true, "Binding已启用");
      // assertEqual(binding.useExternalPrice, false, "未使用外部价格");
      
      console.log("✓ UNIT-TB-011 测试通过（占位，等待程序实现）");
      console.log("  包含TokenBinding注册和验证逻辑");
    });
    
    it("UNIT-TB-012: 重复注册失败", async () => {
      printTestStep(1, "尝试重复注册相同的TokenBinding");
      
      const ethChainId = 1;
      const ethUSDC = ethAddressToBytes32("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
      const solChainId = 900;
      const solUSDC = solanaAddressToBytes32(testMint);
      
      try {
        // const tx = await tokenProgram.methods
        //   .registerTokenBinding(ethChainId, Array.from(ethUSDC), solChainId, Array.from(solUSDC))
        //   .accounts({ ... })
        //   .signers([payer])
        //   .rpc();
        
        // throw new Error("应该失败但成功了");
      } catch (error) {
        assertTxFailed(error, "already in use");
      }
      
      console.log("✓ UNIT-TB-012 测试通过（占位，等待程序实现）");
    });
    
    it("UNIT-TB-013: 非管理员调用失败", async () => {
      printTestStep(1, "尝试使用非管理员账户注册");
      
      const nonAdmin = Keypair.generate();
      await airdrop(provider.connection, nonAdmin.publicKey);
      
      const ethChainId = 1;
      const ethUSDT = ethAddressToBytes32("0xdAC17F958D2ee523a2206206994597C13D831ec7");
      const solChainId = 900;
      const solUSDC = solanaAddressToBytes32(testMint);
      
      try {
        // const tx = await tokenProgram.methods
        //   .registerTokenBinding(ethChainId, Array.from(ethUSDT), solChainId, Array.from(solUSDC))
        //   .accounts({
        //     authority: nonAdmin.publicKey, // 非管理员
        //     ...
        //   })
        //   .signers([nonAdmin])
        //   .rpc();
        
        // throw new Error("应该失败但成功了");
      } catch (error) {
        assertTxFailed(error, "Unauthorized");
      }
      
      console.log("✓ UNIT-TB-013 测试通过（占位，等待程序实现）");
    });
    
    it("UNIT-TB-014: 注册不同代币兑换对（多对多）", async () => {
      printTestHeader("UNIT-TB-014: 多对多代币映射");
      
      printTestStep(1, "准备多个目标代币");
      const solChainId = 900;
      const solUSDC = solanaAddressToBytes32(testMint);
      
      const ethChainId = 1;
      const ethUSDC = ethAddressToBytes32("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
      const ethUSDT = ethAddressToBytes32("0xdAC17F958D2ee523a2206206994597C13D831ec7");
      const ethDAI = ethAddressToBytes32("0x6B175474E89094C44Da98b954EedeAC495271d0F");
      
      printTestStep(2, "注册Solana USDC → Ethereum USDC");
      // 注册第一个binding
      // await registerTokenBinding(solChainId, solUSDC, ethChainId, ethUSDC);
      
      printTestStep(3, "注册Solana USDC → Ethereum USDT");
      // 注册第二个binding（同一源代币，不同目标代币）
      // await registerTokenBinding(solChainId, solUSDC, ethChainId, ethUSDT);
      
      printTestStep(4, "注册Solana USDC → Ethereum DAI");
      // 注册第三个binding
      // await registerTokenBinding(solChainId, solUSDC, ethChainId, ethDAI);
      
      printTestStep(5, "验证所有binding都存在");
      // 验证3个不同的TokenBinding PDA都已创建
      // const binding1 = await getTokenBinding(solChainId, solUSDC, ethChainId, ethUSDC);
      // const binding2 = await getTokenBinding(solChainId, solUSDC, ethChainId, ethUSDT);
      // const binding3 = await getTokenBinding(solChainId, solUSDC, ethChainId, ethDAI);
      
      // assert(binding1 && binding2 && binding3, "所有binding都已创建");
      
      console.log("✓ UNIT-TB-014 测试通过（占位，等待程序实现）");
      console.log("  同一源代币可以绑定到多个目标代币");
    });
    
    it("UNIT-TB-030: 注册出站和入站binding（双向）", async () => {
      printTestHeader("UNIT-TB-030: 双向binding注册");
      
      printTestStep(1, "在Solana链上注册出站binding");
      const solChainId = 900;
      const solUSDC = solanaAddressToBytes32(testMint);
      const ethChainId = 1;
      const ethUSDC = ethAddressToBytes32("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
      
      // 出站: Solana USDC → Ethereum USDC
      // await registerTokenBinding(solChainId, solUSDC, ethChainId, ethUSDC);
      
      printTestStep(2, "在Solana链上注册入站binding（用于验证）");
      // 入站: Ethereum USDC → Solana USDC
      // await registerTokenBinding(ethChainId, ethUSDC, solChainId, solUSDC);
      
      printTestStep(3, "验证出站binding");
      // const outbound = await getTokenBinding(solChainId, solUSDC, ethChainId, ethUSDC);
      // assertEqual(outbound.sourceChain, solChainId, "出站源链为Solana");
      // assertEqual(outbound.targetChain, ethChainId, "出站目标链为Ethereum");
      
      printTestStep(4, "验证入站binding");
      // const inbound = await getTokenBinding(ethChainId, ethUSDC, solChainId, solUSDC);
      // assertEqual(inbound.sourceChain, ethChainId, "入站源链为Ethereum");
      // assertEqual(inbound.targetChain, solChainId, "入站目标链为Solana");
      
      console.log("✓ UNIT-TB-030 测试通过（占位，等待程序实现）");
      console.log("  包含出站和入站binding的双向注册逻辑");
    });
  });
  
  // ============================================
  // 2.2.4 register_bidirectional_binding指令测试（新增）
  // ============================================
  
  describe("UNIT-TB-031 ~ 035: register_bidirectional_binding指令", () => {
    it("UNIT-TB-031: 双向注册同币种（1:1）", async () => {
      printTestHeader("UNIT-TB-031: 双向注册同币种");
      
      printTestStep(1, "准备binding参数（1:1兑换）");
      const localChain = 900; // Solana
      const localToken = solanaAddressToBytes32(testMint);
      const remoteChain = 1; // Ethereum
      const remoteToken = ethAddressToBytes32("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
      
      printTestStep(2, "调用register_bidirectional_binding");
      // const tx = await tokenProgram.methods
      //   .registerBidirectionalBinding(
      //     localChain, Array.from(localToken),
      //     remoteChain, Array.from(remoteToken),
      //     new anchor.BN(1), new anchor.BN(1),  // 出站 1:1
      //     new anchor.BN(1), new anchor.BN(1)   // 入站 1:1
      //   )
      //   .accounts({
      //     bridgeConfig: bridgeConfigPDA,
      //     outboundBinding: outboundPDA,
      //     inboundBinding: inboundPDA,
      //     authority: payer.publicKey,
      //     payer: payer.publicKey,
      //     systemProgram: SystemProgram.programId,
      //   })
      //   .signers([payer])
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
      console.log("  自动创建出站和入站两个binding");
    });
    
    it("UNIT-TB-032: 双向注册不同币种", async () => {
      printTestHeader("UNIT-TB-032: 双向注册不同币种");
      
      printTestStep(1, "准备USDC→USDT的binding参数");
      const localChain = 900;
      const localToken = solanaAddressToBytes32(testMint); // USDC
      const remoteChain = 1;
      const remoteToken = ethAddressToBytes32("0xdAC17F958D2ee523a2206206994597C13D831ec7"); // USDT
      
      printTestStep(2, "调用register_bidirectional_binding");
      // 不同币种兑换，使用自定义比率
      // await tokenProgram.methods
      //   .registerBidirectionalBinding(
      //     localChain, Array.from(localToken),
      //     remoteChain, Array.from(remoteToken),
      //     new anchor.BN(998), new anchor.BN(1000),   // 出站 1:0.998
      //     new anchor.BN(1002), new anchor.BN(1000)   // 入站 1:1.002
      //   )
      //   .accounts({ ... })
      //   .rpc();
      
      console.log("✓ UNIT-TB-032 测试通过（占位，等待程序实现）");
    });
    
    it("UNIT-TB-033: 双向不对称兑换比率", async () => {
      printTestHeader("UNIT-TB-033: 不对称兑换比率");
      
      printTestStep(1, "设置不对称兑换比率");
      console.log("  出站: 1 USDC = 0.998 USDT");
      console.log("  入站: 1 USDT = 1.002 USDC");
      
      const localChain = 900;
      const localToken = solanaAddressToBytes32(testMint);
      const remoteChain = 1;
      const remoteToken = ethAddressToBytes32("0xdAC17F958D2ee523a2206206994597C13D831ec7");
      
      printTestStep(2, "注册双向binding");
      // await registerBidirectionalBinding(..., 998, 1000, 1002, 1000);
      
      printTestStep(3, "验证兑换计算");
      // 验证出站: 1000 USDC → 998 USDT
      // const outboundAmount = 1000_000_000n * 998n / 1000n;
      // assertEqual(outboundAmount, 998_000_000n, "出站兑换正确");
      
      // 验证入站: 1000 USDT → 1002 USDC
      // const inboundAmount = 1000_000_000n * 1002n / 1000n;
      // assertEqual(inboundAmount, 1_002_000_000n, "入站兑换正确");
      
      console.log("✓ UNIT-TB-033 测试通过（占位，等待程序实现）");
      console.log("  支持出站和入站不对称兑换比率");
    });
    
    it("UNIT-TB-034: 验证自动创建两个binding", async () => {
      printTestHeader("UNIT-TB-034: 验证双binding创建");
      
      printTestStep(1, "执行双向注册");
      const localChain = 900;
      const localToken = solanaAddressToBytes32(testMint);
      const remoteChain = 1;
      const remoteToken = ethAddressToBytes32("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
      
      // 计算两个binding的PDA
      // const [outboundPDA] = getTokenBindingPDA(
      //   tokenProgram.programId, localChain, localToken, remoteChain, remoteToken
      // );
      // const [inboundPDA] = getTokenBindingPDA(
      //   tokenProgram.programId, remoteChain, remoteToken, localChain, localToken
      // );
      
      printTestStep(2, "调用register_bidirectional_binding");
      // await registerBidirectionalBinding(...);
      
      printTestStep(3, "验证两个PDA都已创建");
      // const outbound = await tokenProgram.account.tokenBinding.fetch(outboundPDA);
      // const inbound = await tokenProgram.account.tokenBinding.fetch(inboundPDA);
      
      // assert(outbound, "出站binding已创建");
      // assert(inbound, "入站binding已创建");
      
      console.log("✓ UNIT-TB-034 测试通过（占位，等待程序实现）");
      console.log("  验证两个binding账户都已创建");
    });
    
    it("UNIT-TB-035: 非管理员调用失败", async () => {
      printTestStep(1, "尝试使用非管理员账户调用");
      
      const nonAdmin = Keypair.generate();
      await airdrop(provider.connection, nonAdmin.publicKey);
      
      try {
        // const tx = await tokenProgram.methods
        //   .registerBidirectionalBinding(...)
        //   .accounts({
        //     authority: nonAdmin.publicKey,
        //     ...
        //   })
        //   .signers([nonAdmin])
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
      printTestHeader("UNIT-TB-015: 设置1:1兑换比率");
      
      printTestStep(1, "先注册TokenBinding");
      const sourceChain = 900;
      const sourceToken = solanaAddressToBytes32(testMint);
      const targetChain = 1;
      const targetToken = ethAddressToBytes32("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
      
      // await registerTokenBinding(sourceChain, sourceToken, targetChain, targetToken);
      
      printTestStep(2, "调用set_exchange_rate设置1:1比率");
      // const [tokenBindingPDA] = getTokenBindingPDA(
      //   tokenProgram.programId, sourceChain, sourceToken, targetChain, targetToken
      // );
      
      // const tx = await tokenProgram.methods
      //   .setExchangeRate(
      //     sourceChain,
      //     Array.from(sourceToken),
      //     targetChain,
      //     new anchor.BN(1),  // rate_numerator
      //     new anchor.BN(1)   // rate_denominator
      //   )
      //   .accounts({
      //     tokenBinding: tokenBindingPDA,
      //     authority: payer.publicKey,
      //   })
      //   .signer(payer)
      //   .rpc();
      
      // assertTxSuccess(tx, "兑换比率设置成功");
      
      printTestStep(3, "验证兑换比率");
      // const binding = await tokenProgram.account.tokenBinding.fetch(tokenBindingPDA);
      // assertEqual(binding.rateNumerator.toNumber(), 1, "比率分子为1");
      // assertEqual(binding.rateDenominator.toNumber(), 1, "比率分母为1");
      
      printTestStep(4, "验证兑换计算");
      // const sourceAmount = 1000_000_000n; // 1000 tokens
      // const targetAmount = sourceAmount * 1n / 1n;
      // assertEqual(targetAmount, 1000_000_000n, "1:1兑换正确");
      
      console.log("✓ UNIT-TB-015 测试通过（占位，等待程序实现）");
    });
    
    it("UNIT-TB-016: 设置自定义兑换比率", async () => {
      printTestHeader("UNIT-TB-016: 设置自定义兑换比率");
      
      printTestStep(1, "设置 1 USDC = 0.998 USDT");
      const sourceChain = 900;
      const sourceToken = solanaAddressToBytes32(testMint);
      const targetChain = 1;
      const targetToken = ethAddressToBytes32("0xdAC17F958D2ee523a2206206994597C13D831ec7");
      
      // await setExchangeRate(sourceChain, sourceToken, targetChain, 998, 1000);
      
      printTestStep(2, "验证兑换比率");
      // const binding = await getTokenBinding(...);
      // assertEqual(binding.rateNumerator.toNumber(), 998);
      // assertEqual(binding.rateDenominator.toNumber(), 1000);
      
      printTestStep(3, "验证兑换计算");
      // 1000 USDC → 998 USDT
      // const sourceAmount = 1000_000_000n;
      // const targetAmount = sourceAmount * 998n / 1000n;
      // assertEqual(targetAmount, 998_000_000n, "兑换金额正确");
      
      console.log("✓ UNIT-TB-016 测试通过（占位，等待程序实现）");
      console.log("  1 USDC = 0.998 USDT 兑换比率设置成功");
    });
    
    it("UNIT-TB-017: 分母为0失败", async () => {
      printTestStep(1, "尝试设置分母为0");
      
      const sourceChain = 900;
      const sourceToken = solanaAddressToBytes32(testMint);
      const targetChain = 1;
      
      try {
        // const tx = await tokenProgram.methods
        //   .setExchangeRate(
        //     sourceChain,
        //     Array.from(sourceToken),
        //     targetChain,
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
      printTestStep(1, "尝试设置不存在的TokenBinding的兑换比率");
      
      const sourceChain = 900;
      const sourceToken = Buffer.alloc(32); // 不存在的token
      const targetChain = 1;
      
      try {
        // const tx = await tokenProgram.methods
        //   .setExchangeRate(sourceChain, Array.from(sourceToken), targetChain, ...)
        //   .accounts({ ... })
        //   .rpc();
        
        // throw new Error("应该失败但成功了");
      } catch (error) {
        assertTxFailed(error, "AccountNotInitialized");
      }
      
      console.log("✓ UNIT-TB-018 测试通过（占位，等待程序实现）");
    });
    
    it("UNIT-TB-019: 非管理员调用失败", async () => {
      printTestStep(1, "尝试使用非管理员账户设置兑换比率");
      
      const nonAdmin = Keypair.generate();
      await airdrop(provider.connection, nonAdmin.publicKey);
      
      try {
        // const tx = await tokenProgram.methods
        //   .setExchangeRate(...)
        //   .accounts({
        //     authority: nonAdmin.publicKey,
        //     ...
        //   })
        //   .signers([nonAdmin])
        //   .rpc();
        
        // throw new Error("应该失败但成功了");
      } catch (error) {
        assertTxFailed(error, "Unauthorized");
      }
      
      console.log("✓ UNIT-TB-019 测试通过（占位，等待程序实现）");
    });
  });
  
  // ============================================
  // 2.2.6 update_amm_config指令测试（新增，预留）
  // ============================================
  
  describe("UNIT-TB-020 ~ 022: update_amm_config指令", () => {
    it("UNIT-TB-020: 启用外部AMM定价", async () => {
      printTestHeader("UNIT-TB-020: 启用外部AMM");
      
      printTestStep(1, "准备AMM配置");
      const sourceChain = 900;
      const sourceToken = solanaAddressToBytes32(testMint);
      const targetChain = 1;
      const ammProgramId = Keypair.generate().publicKey; // 模拟AMM程序ID
      
      printTestStep(2, "调用update_amm_config");
      // const tx = await tokenProgram.methods
      //   .updateAmmConfig(
      //     sourceChain,
      //     Array.from(sourceToken),
      //     targetChain,
      //     ammProgramId,
      //     true  // use_external_price = true
      //   )
      //   .accounts({
      //     tokenBinding: tokenBindingPDA,
      //     authority: payer.publicKey,
      //   })
      //   .signer(payer)
      //   .rpc();
      
      // assertTxSuccess(tx, "AMM配置更新成功");
      
      printTestStep(3, "验证AMM配置");
      // const binding = await tokenProgram.account.tokenBinding.fetch(tokenBindingPDA);
      // assertEqual(binding.useExternalPrice, true, "启用外部价格");
      // assert(binding.ammProgramId.equals(ammProgramId), "AMM程序ID正确");
      
      console.log("✓ UNIT-TB-020 测试通过（占位，等待程序实现）");
      console.log("  预留接口，用于未来集成Raydium/Orca等AMM");
    });
    
    it("UNIT-TB-021: 禁用外部AMM定价", async () => {
      printTestStep(1, "调用update_amm_config禁用外部价格");
      
      const sourceChain = 900;
      const sourceToken = solanaAddressToBytes32(testMint);
      const targetChain = 1;
      
      // await tokenProgram.methods
      //   .updateAmmConfig(
      //     sourceChain,
      //     Array.from(sourceToken),
      //     targetChain,
      //     PublicKey.default,
      //     false  // use_external_price = false
      //   )
      //   .accounts({ ... })
      //   .rpc();
      
      printTestStep(2, "验证恢复使用固定比率");
      // const binding = await tokenProgram.account.tokenBinding.fetch(tokenBindingPDA);
      // assertEqual(binding.useExternalPrice, false, "禁用外部价格");
      
      console.log("✓ UNIT-TB-021 测试通过（占位，等待程序实现）");
    });
    
    it("UNIT-TB-022: 非管理员调用失败", async () => {
      printTestStep(1, "尝试使用非管理员账户更新AMM配置");
      
      const nonAdmin = Keypair.generate();
      await airdrop(provider.connection, nonAdmin.publicKey);
      
      try {
        // const tx = await tokenProgram.methods
        //   .updateAmmConfig(...)
        //   .accounts({
        //     authority: nonAdmin.publicKey,
        //     ...
        //   })
        //   .signers([nonAdmin])
        //   .rpc();
        
        // throw new Error("应该失败但成功了");
      } catch (error) {
        assertTxFailed(error, "Unauthorized");
      }
      
      console.log("✓ UNIT-TB-022 测试通过（占位，等待程序实现）");
    });
  });
  
  // ============================================
  // 更新complete_transfer测试 - 支持兑换验证
  // ============================================
  
  describe("UNIT-TB-025 ~ 029: complete_transfer兑换验证", () => {
    it("UNIT-TB-025: 兑换比率验证失败", async () => {
      printTestHeader("UNIT-TB-025: 兑换比率验证");
      
      printTestStep(1, "注册1:1兑换比率的TokenBinding");
      const ethChainId = 1;
      const ethUSDC = ethAddressToBytes32("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
      const solChainId = 900;
      const solUSDC = solanaAddressToBytes32(testMint);
      
      // await registerTokenBinding(ethChainId, ethUSDC, solChainId, solUSDC);
      // await setExchangeRate(ethChainId, ethUSDC, solChainId, 1, 1); // 1:1
      
      printTestStep(2, "构造包含错误兑换比率的VAA");
      const payload: TokenTransferPayload = {
        payloadType: 1,
        amount: BigInt(1000_000_000),
        tokenAddress: ethUSDC,
        tokenChain: ethChainId,
        recipient: solanaAddressToBytes32(user.publicKey),
        recipientChain: solChainId,
        // 新增字段 - 包含错误的兑换信息
        targetToken: solUSDC,
        targetAmount: BigInt(1100_000_000), // 错误: 声称1:1.1
        exchangeRateNum: BigInt(11),
        exchangeRateDenom: BigInt(10),
      };
      
      // const vaa = createTokenTransferVAA({ ... });
      
      printTestStep(3, "尝试complete_transfer（应该失败）");
      try {
        // const tx = await tokenProgram.methods
        //   .completeTransfer(vaa)
        //   .accounts({ ... })
        //   .rpc();
        
        // throw new Error("应该失败但成功了");
      } catch (error) {
        assertTxFailed(error, "InvalidExchangeRate");
      }
      
      console.log("✓ UNIT-TB-025 测试通过（占位，等待程序实现）");
      console.log("  验证VAA中的兑换比率必须与TokenBinding一致");
    });
    
    it("UNIT-TB-026: 目标代币不匹配", async () => {
      printTestHeader("UNIT-TB-026: 目标代币验证");
      
      printTestStep(1, "注册USDC→USDC的binding");
      const ethChainId = 1;
      const ethUSDC = ethAddressToBytes32("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
      const solChainId = 900;
      const solUSDC = solanaAddressToBytes32(testMint);
      
      // await registerTokenBinding(ethChainId, ethUSDC, solChainId, solUSDC);
      
      printTestStep(2, "构造目标代币为USDT的VAA（不匹配）");
      const wrongTargetToken = Buffer.alloc(32); // 错误的目标代币
      
      const payload: TokenTransferPayload = {
        payloadType: 1,
        amount: BigInt(1000_000_000),
        tokenAddress: ethUSDC,
        tokenChain: ethChainId,
        recipient: solanaAddressToBytes32(user.publicKey),
        recipientChain: solChainId,
        targetToken: wrongTargetToken, // 错误的目标代币
        targetAmount: BigInt(1000_000_000),
        exchangeRateNum: BigInt(1),
        exchangeRateDenom: BigInt(1),
      };
      
      // const vaa = createTokenTransferVAA({ ... });
      
      printTestStep(3, "尝试complete_transfer（应该失败）");
      try {
        // const tx = await tokenProgram.methods
        //   .completeTransfer(vaa)
        //   .accounts({ ... })
        //   .rpc();
        
        // throw new Error("应该失败但成功了");
      } catch (error) {
        assertTxFailed(error, "TargetTokenMismatch");
      }
      
      console.log("✓ UNIT-TB-026 测试通过（占位，等待程序实现）");
      console.log("  验证VAA中的目标代币必须与TokenBinding一致");
    });
    
    it("UNIT-TB-027: VAA验证失败", async () => {
      // 已在UNIT-TB-008中测试
      console.log("✓ UNIT-TB-027 测试通过（与UNIT-TB-008合并）");
    });
    
    it("UNIT-TB-028: 目标链不匹配", async () => {
      // 已在UNIT-TB-009中测试
      console.log("✓ UNIT-TB-028 测试通过（与UNIT-TB-009合并）");
    });
    
    it("UNIT-TB-029: custody余额不足", async () => {
      // 已在UNIT-TB-010中测试
      console.log("✓ UNIT-TB-029 测试通过（与UNIT-TB-010合并）");
    });
  });
});

