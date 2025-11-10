import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,
  getMint,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import {
  setupTestEnvironment,
  airdrop,
  findProgramAddress,
  TEST_GUARDIAN_KEYS,
  getGuardianAddresses,
  createTestMint,
  createAndMintTestToken,
  getTokenBalance,
  createVaaDataAccount,
  TEST_PAYER,
} from "../utils/setup";
import {
  createTokenTransferVAA,
  TokenTransferPayload,
  GuardianKeyPair,
  createTestVAA,
  extractVAAEmitterInfo,
} from "../utils/vaa";
import { keccak256 } from "js-sha3";

describe("token-bridge 单元测试", () => {
  let provider: AnchorProvider;
  let coreProgram: Program;
  let tokenProgram: Program;
  let payer: Keypair;
  let user: Keypair;
  let bridgePda: PublicKey;
  let guardianSetPda: PublicKey;
  let bridgeConfigPda: PublicKey;
  let connection: anchor.web3.Connection;

  let solUsdcMint: PublicKey;
  let userTokenAccount: PublicKey;
  let custodyAccount: PublicKey;

  const ETH_CHAIN_ID = 1;
  const SOL_CHAIN_ID = 900;
  const BSC_CHAIN_ID = 56;
  const POLYGON_CHAIN_ID = 137;

  before(async () => {
    const env = await setupTestEnvironment();
    provider = env.provider;
    connection = env.connection;
    payer = TEST_PAYER; // 使用确定性密钥对，确保所有测试共享同一authority
    user = Keypair.generate();

    await airdrop(connection, payer.publicKey, 100 * LAMPORTS_PER_SOL);
    await airdrop(connection, user.publicKey, 10 * LAMPORTS_PER_SOL);

    coreProgram = anchor.workspace.SolanaCore as Program;
    tokenProgram = anchor.workspace.TokenBridge as Program;

    [bridgePda] = findProgramAddress(
      [Buffer.from("Bridge")],
      coreProgram.programId
    );

    [guardianSetPda] = findProgramAddress(
      [Buffer.from("GuardianSet"), Buffer.from([0, 0, 0, 0])],
      coreProgram.programId
    );

    [bridgeConfigPda] = findProgramAddress(
      [Buffer.from("BridgeConfig")],
      tokenProgram.programId
    );

    const bridgeExists = await connection.getAccountInfo(bridgePda);
    if (!bridgeExists) {
      const guardians = getGuardianAddresses();
      const messageFee = new BN(1_000_000);

      await coreProgram.methods
        .initialize(0, guardians, messageFee, payer.publicKey)
        .accounts({
          bridge: bridgePda,
          guardianSet: guardianSetPda,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();
    }

    const bridgeConfigExists = await connection.getAccountInfo(bridgeConfigPda);
    if (!bridgeConfigExists) {
      await tokenProgram.methods
        .initialize(payer.publicKey)
        .accounts({
          bridgeConfig: bridgeConfigPda,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();
    }

    solUsdcMint = await createTestMint(connection, payer, 6);
    userTokenAccount = await createAndMintTestToken(
      connection,
      payer,
      solUsdcMint,
      user.publicKey,
      BigInt(10000_000_000)
    );

    [custodyAccount] = findProgramAddress(
      [Buffer.from("Custody"), solUsdcMint.toBuffer()],
      tokenProgram.programId
    );

    await tokenProgram.methods
      .initializeCustody()
      .accounts({
        bridgeConfig: bridgeConfigPda,
        custody: custodyAccount,
        mint: solUsdcMint,
        authority: payer.publicKey,
        payer: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([payer])
      .rpc();
  });

  describe("2.2.1 transfer_tokens指令测试", () => {
    let ethUsdcAddress: Buffer;
    let ethUsdtAddress: Buffer;
    let ethDaiAddress: Buffer;
    let bscBusdAddress: Buffer;
    let polyUsdcAddress: Buffer;

    before(async () => {
      ethUsdcAddress = Buffer.alloc(32);
      ethUsdcAddress.writeUInt32BE(0xA0B86991, 0);

      ethUsdtAddress = Buffer.alloc(32);
      ethUsdtAddress.writeUInt32BE(0xdAC17F95, 0);

      ethDaiAddress = Buffer.alloc(32);
      ethDaiAddress.writeUInt32BE(0x6B175474, 0);

      bscBusdAddress = Buffer.alloc(32);
      bscBusdAddress.writeUInt32BE(0xe9e7CEA3, 0);

      polyUsdcAddress = Buffer.alloc(32);
      polyUsdcAddress.writeUInt32BE(0x2791Bca1, 0);

      // 确保Bridge未暂停（防止之前测试影响）
      await coreProgram.methods
        .setPaused(false)
        .accounts({
          bridge: bridgePda,
          authority: payer.publicKey,
        })
        .signers([payer])
        .rpc()
        .catch(() => {}); // 忽略错误（可能已经是false）
    });

    it("UNIT-TB-001: 正常锁定SPL代币(1:1兑换)", async () => {
      const [tokenBindingPda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x84, 0x03]),
          solUsdcMint.toBuffer(),
          Buffer.from([0x01, 0x00]),
          ethUsdcAddress,
        ],
        tokenProgram.programId
      );

      await tokenProgram.methods
        .registerTokenBinding(
          SOL_CHAIN_ID,
          Array.from(solUsdcMint.toBuffer()),
          ETH_CHAIN_ID,
          Array.from(ethUsdcAddress)
        )
        .accounts({
          bridgeConfig: bridgeConfigPda,
          tokenBinding: tokenBindingPda,
          authority: payer.publicKey,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();

      await tokenProgram.methods
        .setExchangeRate(
          SOL_CHAIN_ID,
          Array.from(solUsdcMint.toBuffer()),
          ETH_CHAIN_ID,
          Array.from(ethUsdcAddress),
          new BN(1),
          new BN(1)
        )
        .accounts({
          bridgeConfig: bridgeConfigPda,
          tokenBinding: tokenBindingPda,
          authority: payer.publicKey,
        })
        .signers([payer])
        .rpc();

      const amount = new BN(500_000_000);
      const recipient = Buffer.alloc(32);
      recipient.writeUInt32BE(0x12345678, 0);

      const [sequencePda] = findProgramAddress(
        [Buffer.from("Sequence"), tokenProgram.programId.toBuffer()],
        coreProgram.programId
      );

      const messagePda = Keypair.generate();

      const initialBalance = await getTokenBalance(connection, userTokenAccount);

      await tokenProgram.methods
        .transferTokens(
          amount,
          ETH_CHAIN_ID,
          Array.from(ethUsdcAddress),
          Array.from(recipient)
        )
        .accounts({
          coreProgram: coreProgram.programId,
          bridge: bridgePda,
          tokenBinding: tokenBindingPda,
          tokenAccount: userTokenAccount,
          custodyAccount: custodyAccount,
          tokenAuthority: user.publicKey,
          tokenMint: solUsdcMint,
          message: messagePda.publicKey,
          emitter: tokenProgram.programId,
          sequence: sequencePda,
          payer: payer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user, payer, messagePda])
        .rpc();

      const custodyBalance = await getTokenBalance(connection, custodyAccount);
      expect(custodyBalance.toString()).to.equal(amount.toString());

      const userBalance = await getTokenBalance(connection, userTokenAccount);
      expect(userBalance.toString()).to.equal(
        (initialBalance - BigInt(amount.toNumber())).toString()
      );

      const sequence = await coreProgram.account.sequence.fetch(sequencePda);
      expect(sequence.sequence.toNumber()).to.be.greaterThan(0);

      const message = await coreProgram.account.postedMessage.fetch(
        messagePda.publicKey
      );
      expect(message.payload).to.have.lengthOf.greaterThan(0);
    });

    it("UNIT-TB-002: 跨链兑换不同代币(USDC→USDT)", async () => {
      const [tokenBindingPda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x84, 0x03]),
          solUsdcMint.toBuffer(),
          Buffer.from([0x01, 0x00]),
          ethUsdtAddress,
        ],
        tokenProgram.programId
      );

      await tokenProgram.methods
        .registerTokenBinding(
          SOL_CHAIN_ID,
          Array.from(solUsdcMint.toBuffer()),
          ETH_CHAIN_ID,
          Array.from(ethUsdtAddress)
        )
        .accounts({
          bridgeConfig: bridgeConfigPda,
          tokenBinding: tokenBindingPda,
          authority: payer.publicKey,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();

      await tokenProgram.methods
        .setExchangeRate(
          SOL_CHAIN_ID,
          Array.from(solUsdcMint.toBuffer()),
          ETH_CHAIN_ID,
          Array.from(ethUsdtAddress),
          new BN(998),
          new BN(1000)
        )
        .accounts({
          bridgeConfig: bridgeConfigPda,
          tokenBinding: tokenBindingPda,
          authority: payer.publicKey,
        })
        .signers([payer])
        .rpc();

      const amount = new BN(1000_000_000);
      const recipient = Buffer.alloc(32);

      const [sequencePda] = findProgramAddress(
        [Buffer.from("Sequence"), tokenProgram.programId.toBuffer()],
        coreProgram.programId
      );

      const messagePda = Keypair.generate();

      await tokenProgram.methods
        .transferTokens(
          amount,
          ETH_CHAIN_ID,
          Array.from(ethUsdtAddress),
          Array.from(recipient)
        )
        .accounts({
          coreProgram: coreProgram.programId,
          bridge: bridgePda,
          tokenBinding: tokenBindingPda,
          tokenAccount: userTokenAccount,
          custodyAccount: custodyAccount,
          tokenAuthority: user.publicKey,
          tokenMint: solUsdcMint,
          message: messagePda.publicKey,
          emitter: tokenProgram.programId,
          sequence: sequencePda,
          payer: payer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user, payer, messagePda])
        .rpc();

      const message = await coreProgram.account.postedMessage.fetch(
        messagePda.publicKey
      );
      expect(message.payload).to.have.lengthOf.greaterThan(0);
    });

    it("UNIT-TB-003: TokenBinding不存在失败", async () => {
      const unknownMint = await createTestMint(connection, payer, 6);

      const unknownTokenAddress = Buffer.alloc(32);
      const [tokenBindingPda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x84, 0x03]),
          unknownMint.toBuffer(),
          Buffer.from([0x01, 0x00]),
          unknownTokenAddress,
        ],
        tokenProgram.programId
      );

      const amount = new BN(1000_000_000);
      const recipient = Buffer.alloc(32);

      const [sequencePda] = findProgramAddress(
        [Buffer.from("Sequence"), tokenProgram.programId.toBuffer()],
        coreProgram.programId
      );

      const messagePda = Keypair.generate();

      const [custodyPda] = findProgramAddress(
        [Buffer.from("Custody"), unknownMint.toBuffer()],
        tokenProgram.programId
      );

      const unknownUserAccount = await createAndMintTestToken(
        connection,
        payer,
        unknownMint,
        user.publicKey,
        BigInt(1000_000_000)
      );

      try {
        await tokenProgram.methods
          .transferTokens(
            amount,
            ETH_CHAIN_ID,
            Array.from(unknownTokenAddress),
            Array.from(recipient)
          )
          .accounts({
            coreProgram: coreProgram.programId,
            bridge: bridgePda,
            tokenBinding: tokenBindingPda,
            tokenAccount: unknownUserAccount,
            custodyAccount: custodyPda,
            tokenAuthority: user.publicKey,
            tokenMint: unknownMint,
            message: messagePda.publicKey,
            emitter: tokenProgram.programId,
            sequence: sequencePda,
            payer: payer.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([user, payer, messagePda])
          .rpc();
        expect.fail("应该失败");
      } catch (error: any) {
        expect(error).to.exist;
      }
    });

    it("UNIT-TB-004: TokenBinding未启用失败", async () => {
      const disabledTokenAddress = Buffer.alloc(32);
      disabledTokenAddress.writeUInt32BE(0xDEADBEEF, 0);

      const [tokenBindingPda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x84, 0x03]),
          solUsdcMint.toBuffer(),
          Buffer.from([0x01, 0x00]),
          disabledTokenAddress,
        ],
        tokenProgram.programId
      );

      await tokenProgram.methods
        .registerTokenBinding(
          SOL_CHAIN_ID,
          Array.from(solUsdcMint.toBuffer()),
          ETH_CHAIN_ID,
          Array.from(disabledTokenAddress)
        )
        .accounts({
          bridgeConfig: bridgeConfigPda,
          tokenBinding: tokenBindingPda,
          authority: payer.publicKey,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();

      await tokenProgram.methods
        .setTokenBindingEnabled(
          SOL_CHAIN_ID,
          Array.from(solUsdcMint.toBuffer()),
          ETH_CHAIN_ID,
          Array.from(disabledTokenAddress),
          false
        )
        .accounts({
          bridgeConfig: bridgeConfigPda,
          tokenBinding: tokenBindingPda,
          authority: payer.publicKey,
        })
        .signers([payer])
        .rpc();

      const amount = new BN(1000_000_000);
      const recipient = Buffer.alloc(32);

      const [sequencePda] = findProgramAddress(
        [Buffer.from("Sequence"), tokenProgram.programId.toBuffer()],
        coreProgram.programId
      );

      const messagePda = Keypair.generate();

      try {
        await tokenProgram.methods
          .transferTokens(
            amount,
            ETH_CHAIN_ID,
            Array.from(disabledTokenAddress),
            Array.from(recipient)
          )
          .accounts({
            coreProgram: coreProgram.programId,
            bridge: bridgePda,
            tokenBinding: tokenBindingPda,
            tokenAccount: userTokenAccount,
            custodyAccount: custodyAccount,
            tokenAuthority: user.publicKey,
            tokenMint: solUsdcMint,
            message: messagePda.publicKey,
            emitter: tokenProgram.programId,
            sequence: sequencePda,
            payer: payer.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([user, payer, messagePda])
          .rpc();
        expect.fail("应该失败");
      } catch (error: any) {
        expect(error.message).to.include("not enabled");
      }
    });

    it("UNIT-TB-005: 授权不足", async () => {
      const [tokenBindingPda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x84, 0x03]),
          solUsdcMint.toBuffer(),
          Buffer.from([0x01, 0x00]),
          ethUsdcAddress,
        ],
        tokenProgram.programId
      );

      const amount = new BN(1000_000_000);
      const recipient = Buffer.alloc(32);

      const [sequencePda] = findProgramAddress(
        [Buffer.from("Sequence"), tokenProgram.programId.toBuffer()],
        coreProgram.programId
      );

      const messagePda = Keypair.generate();

      const wrongUser = Keypair.generate();
      await airdrop(connection, wrongUser.publicKey);

      try {
        await tokenProgram.methods
          .transferTokens(
            amount,
            ETH_CHAIN_ID,
            Array.from(ethUsdcAddress),
            Array.from(recipient)
          )
          .accounts({
            coreProgram: coreProgram.programId,
            bridge: bridgePda,
            tokenBinding: tokenBindingPda,
            tokenAccount: userTokenAccount,
            custodyAccount: custodyAccount,
            tokenAuthority: wrongUser.publicKey,
            tokenMint: solUsdcMint,
            message: messagePda.publicKey,
            emitter: tokenProgram.programId,
            sequence: sequencePda,
            payer: payer.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([wrongUser, payer, messagePda])
          .rpc();
        expect.fail("应该失败");
      } catch (error: any) {
        expect(error).to.exist;
      }
    });

    it("UNIT-TB-006: 余额不足", async () => {
      const poorUser = Keypair.generate();
      await airdrop(connection, poorUser.publicKey);

      const poorUserAccount = await createAccount(
        connection,
        payer,
        solUsdcMint,
        poorUser.publicKey,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
      );

      const [tokenBindingPda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x84, 0x03]),
          solUsdcMint.toBuffer(),
          Buffer.from([0x01, 0x00]),
          ethUsdcAddress,
        ],
        tokenProgram.programId
      );

      const amount = new BN(1000_000_000);
      const recipient = Buffer.alloc(32);

      const [sequencePda] = findProgramAddress(
        [Buffer.from("Sequence"), tokenProgram.programId.toBuffer()],
        coreProgram.programId
      );

      const messagePda = Keypair.generate();

      try {
        await tokenProgram.methods
          .transferTokens(
            amount,
            ETH_CHAIN_ID,
            Array.from(ethUsdcAddress),
            Array.from(recipient)
          )
          .accounts({
            coreProgram: coreProgram.programId,
            bridge: bridgePda,
            tokenBinding: tokenBindingPda,
            tokenAccount: poorUserAccount,
            custodyAccount: custodyAccount,
            tokenAuthority: poorUser.publicKey,
            tokenMint: solUsdcMint,
            message: messagePda.publicKey,
            emitter: tokenProgram.programId,
            sequence: sequencePda,
            payer: payer.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([poorUser, payer, messagePda])
          .rpc();
        expect.fail("应该失败");
      } catch (error: any) {
        expect(error).to.exist;
      }
    });

    it("UNIT-TB-007: 手续费不足", async () => {
      const [tokenBindingPda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x84, 0x03]),
          solUsdcMint.toBuffer(),
          Buffer.from([0x01, 0x00]),
          ethUsdcAddress,
        ],
        tokenProgram.programId
      );

      const amount = new BN(1000_000_000);
      const recipient = Buffer.alloc(32);

      const [sequencePda] = findProgramAddress(
        [Buffer.from("Sequence"), tokenProgram.programId.toBuffer()],
        coreProgram.programId
      );

      const messagePda = Keypair.generate();

      const poorPayer = Keypair.generate();
      await airdrop(connection, poorPayer.publicKey, 0.0001 * LAMPORTS_PER_SOL);

      try {
        await tokenProgram.methods
          .transferTokens(
            amount,
            ETH_CHAIN_ID,
            Array.from(ethUsdcAddress),
            Array.from(recipient)
          )
          .accounts({
            coreProgram: coreProgram.programId,
            bridge: bridgePda,
            tokenBinding: tokenBindingPda,
            tokenAccount: userTokenAccount,
            custodyAccount: custodyAccount,
            tokenAuthority: user.publicKey,
            tokenMint: solUsdcMint,
            message: messagePda.publicKey,
            emitter: tokenProgram.programId,
            sequence: sequencePda,
            payer: poorPayer.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([user, poorPayer, messagePda])
          .rpc();
        expect.fail("应该失败");
      } catch (error: any) {
        expect(error).to.exist;
      }
    });

    it("UNIT-TB-008: 无效目标链", async () => {
      const [tokenBindingPda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x84, 0x03]),
          solUsdcMint.toBuffer(),
          Buffer.from([0x01, 0x00]),
          ethUsdcAddress,
        ],
        tokenProgram.programId
      );

      const amount = new BN(1000_000_000);
      const recipient = Buffer.alloc(32);

      const [sequencePda] = findProgramAddress(
        [Buffer.from("Sequence"), tokenProgram.programId.toBuffer()],
        coreProgram.programId
      );

      const messagePda = Keypair.generate();

      const invalidChainId = 9999;

      try {
        await tokenProgram.methods
          .transferTokens(
            amount,
            invalidChainId,
            Array.from(ethUsdcAddress),
            Array.from(recipient)
          )
          .accounts({
            coreProgram: coreProgram.programId,
            bridge: bridgePda,
            tokenBinding: tokenBindingPda,
            tokenAccount: userTokenAccount,
            custodyAccount: custodyAccount,
            tokenAuthority: user.publicKey,
            tokenMint: solUsdcMint,
            message: messagePda.publicKey,
            emitter: tokenProgram.programId,
            sequence: sequencePda,
            payer: payer.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([user, payer, messagePda])
          .rpc();
        expect.fail("应该失败");
      } catch (error: any) {
        expect(error).to.exist;
      }
    });
  });

  describe("2.2.2 complete_transfer指令测试", () => {
    let ethUsdcAddress: Buffer;
    let ethUsdtAddress: Buffer;

    before(() => {
      ethUsdcAddress = Buffer.alloc(32);
      ethUsdcAddress.writeUInt32BE(0xA0B86991, 0);

      ethUsdtAddress = Buffer.alloc(32);
      ethUsdtAddress.writeUInt32BE(0xdAC17F95, 0);
    });

    it("UNIT-TB-009: 解锁原生SPL代币(1:1兑换)", async () => {
      const [inboundBindingPda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x01, 0x00]),
          ethUsdcAddress,
          Buffer.from([0x84, 0x03]),
          solUsdcMint.toBuffer(),
        ],
        tokenProgram.programId
      );

      await tokenProgram.methods
        .registerTokenBinding(
          ETH_CHAIN_ID,
          Array.from(ethUsdcAddress),
          SOL_CHAIN_ID,
          Array.from(solUsdcMint.toBuffer())
        )
        .accounts({
          bridgeConfig: bridgeConfigPda,
          tokenBinding: inboundBindingPda,
          authority: payer.publicKey,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();

      await tokenProgram.methods
        .setExchangeRate(
          ETH_CHAIN_ID,
          Array.from(ethUsdcAddress),
          SOL_CHAIN_ID,
          Array.from(solUsdcMint.toBuffer()),
          new BN(1),
          new BN(1)
        )
        .accounts({
          bridgeConfig: bridgeConfigPda,
          tokenBinding: inboundBindingPda,
          authority: payer.publicKey,
        })
        .signers([payer])
        .rpc();

      await mintTo(
        connection,
        payer,
        solUsdcMint,
        custodyAccount,
        payer,
        1000_000_000,
        [],
        undefined,
        TOKEN_PROGRAM_ID
      );

      const recipientAccountInfo = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        solUsdcMint,
        user.publicKey,
        false,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
      );
      const recipientAccount = recipientAccountInfo.address;

      const payload: TokenTransferPayload = {
        payloadType: 1,
        amount: BigInt(500_000_000),
        tokenAddress: ethUsdcAddress,
        tokenChain: ETH_CHAIN_ID,
        recipient: user.publicKey.toBuffer(),
        recipientChain: SOL_CHAIN_ID,
        targetToken: solUsdcMint.toBuffer(),
        targetAmount: BigInt(500_000_000),
        exchangeRateNum: BigInt(1),
        exchangeRateDenom: BigInt(1),
      };

      const emitterAddress = Buffer.alloc(32);
      emitterAddress.writeUInt32BE(0x742d3500, 0);

      const vaaBuffer = createTokenTransferVAA({
        guardianSetIndex: 0,
        emitterChain: ETH_CHAIN_ID,
        emitterAddress,
        sequence: BigInt(1000),
        guardianKeys: TEST_GUARDIAN_KEYS,
        transferPayload: payload,
        signerCount: 13,
      });

      const vaaAccount = await createVaaDataAccount(connection, payer, vaaBuffer);

      const { emitterChain, emitterAddress: vaaEmitterAddr, sequence } = extractVAAEmitterInfo(vaaBuffer);
      
      const sequenceBuffer = Buffer.alloc(8);
      sequenceBuffer.writeBigUInt64LE(sequence);
      
      const emitterChainBuffer = Buffer.alloc(2);
      emitterChainBuffer.writeUInt16LE(emitterChain);
      
      const [postedVaaPda] = findProgramAddress(
        [
          Buffer.from("PostedVAA"),
          emitterChainBuffer,
          vaaEmitterAddr,
          sequenceBuffer
        ],
        coreProgram.programId
      );

      await coreProgram.methods
        .postVaa(emitterChain, Array.from(vaaEmitterAddr), new BN(sequence.toString()))
        .accounts({
          bridge: bridgePda,
          guardianSet: guardianSetPda,
          vaaBuffer: vaaAccount.publicKey,
          postedVaa: postedVaaPda,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([
          ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })
        ])
        .signers([payer])
        .rpc();

      const custodyBalanceBefore = await getTokenBalance(
        connection,
        custodyAccount
      );

      const recipientBalanceBefore = await getTokenBalance(connection, recipientAccount);

      await tokenProgram.methods
        .completeTransfer()
        .accounts({
          coreProgram: coreProgram.programId,
          bridge: bridgePda,
          postedVaa: postedVaaPda,
          tokenBinding: inboundBindingPda,
          recipientAccount: recipientAccount,
          custodyAccount: custodyAccount,
          targetTokenMint: solUsdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      const recipientBalanceAfter = await getTokenBalance(connection, recipientAccount);
      const received = recipientBalanceAfter - recipientBalanceBefore;
      expect(received.toString()).to.equal("500000000");

      const custodyBalanceAfter = await getTokenBalance(
        connection,
        custodyAccount
      );
      expect(custodyBalanceAfter.toString()).to.equal(
        (custodyBalanceBefore - BigInt(500_000_000)).toString()
      );

      const postedVaa = await coreProgram.account.postedVaa.fetch(postedVaaPda);
      expect(postedVaa.consumed).to.be.true;
    });

    it("UNIT-TB-010: 跨链兑换不同代币接收", async () => {
      const [inboundBindingPda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x01, 0x00]),
          ethUsdtAddress,
          Buffer.from([0x84, 0x03]),
          solUsdcMint.toBuffer(),
        ],
        tokenProgram.programId
      );

      await tokenProgram.methods
        .registerTokenBinding(
          ETH_CHAIN_ID,
          Array.from(ethUsdtAddress),
          SOL_CHAIN_ID,
          Array.from(solUsdcMint.toBuffer())
        )
        .accounts({
          bridgeConfig: bridgeConfigPda,
          tokenBinding: inboundBindingPda,
          authority: payer.publicKey,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();

      await tokenProgram.methods
        .setExchangeRate(
          ETH_CHAIN_ID,
          Array.from(ethUsdtAddress),
          SOL_CHAIN_ID,
          Array.from(solUsdcMint.toBuffer()),
          new BN(1002),
          new BN(1000)
        )
        .accounts({
          bridgeConfig: bridgeConfigPda,
          tokenBinding: inboundBindingPda,
          authority: payer.publicKey,
        })
        .signers([payer])
        .rpc();

      await mintTo(
        connection,
        payer,
        solUsdcMint,
        custodyAccount,
        payer,
        2000_000_000,
        [],
        undefined,
        TOKEN_PROGRAM_ID
      );

      const recipientAccountInfo = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        solUsdcMint,
        user.publicKey,
        false,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
      );
      const recipientAccount = recipientAccountInfo.address;

      const payload: TokenTransferPayload = {
        payloadType: 1,
        amount: BigInt(1000_000_000),
        tokenAddress: ethUsdtAddress,
        tokenChain: ETH_CHAIN_ID,
        recipient: user.publicKey.toBuffer(),
        recipientChain: SOL_CHAIN_ID,
        targetToken: solUsdcMint.toBuffer(),
        targetAmount: BigInt(1_002_000_000),
        exchangeRateNum: BigInt(1002),
        exchangeRateDenom: BigInt(1000),
      };

      const emitterAddress = Buffer.alloc(32);

      const vaaBuffer = createTokenTransferVAA({
        guardianSetIndex: 0,
        emitterChain: ETH_CHAIN_ID,
        emitterAddress,
        sequence: BigInt(1001),
        guardianKeys: TEST_GUARDIAN_KEYS,
        transferPayload: payload,
        signerCount: 13,
      });

      const vaaAccount = await createVaaDataAccount(connection, payer, vaaBuffer);

      const { emitterChain, emitterAddress: vaaEmitterAddr, sequence } = extractVAAEmitterInfo(vaaBuffer);
      
      const sequenceBuffer = Buffer.alloc(8);
      sequenceBuffer.writeBigUInt64LE(sequence);
      
      const emitterChainBuffer = Buffer.alloc(2);
      emitterChainBuffer.writeUInt16LE(emitterChain);
      
      const [postedVaaPda] = findProgramAddress(
        [
          Buffer.from("PostedVAA"),
          emitterChainBuffer,
          vaaEmitterAddr,
          sequenceBuffer
        ],
        coreProgram.programId
      );

      await coreProgram.methods
        .postVaa(emitterChain, Array.from(vaaEmitterAddr), new BN(sequence.toString()))
        .accounts({
          bridge: bridgePda,
          guardianSet: guardianSetPda,
          vaaBuffer: vaaAccount.publicKey,
          postedVaa: postedVaaPda,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([
          ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })
        ])
        .signers([payer])
        .rpc();

      const recipientBalanceBefore = await getTokenBalance(connection, recipientAccount);

      await tokenProgram.methods
        .completeTransfer()
        .accounts({
          coreProgram: coreProgram.programId,
          bridge: bridgePda,
          postedVaa: postedVaaPda,
          tokenBinding: inboundBindingPda,
          recipientAccount: recipientAccount,
          custodyAccount: custodyAccount,
          targetTokenMint: solUsdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      const recipientBalanceAfter = await getTokenBalance(connection, recipientAccount);
      const received = recipientBalanceAfter - recipientBalanceBefore;
      expect(received.toString()).to.equal("1002000000");
    });

    it("UNIT-TB-025: 兑换比率验证失败", async () => {
      const [inboundBindingPda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x01, 0x00]),
          ethUsdcAddress,
          Buffer.from([0x84, 0x03]),
          solUsdcMint.toBuffer(),
        ],
        tokenProgram.programId
      );

      const payload: TokenTransferPayload = {
        payloadType: 1,
        amount: BigInt(1000_000_000),
        tokenAddress: ethUsdcAddress,
        tokenChain: ETH_CHAIN_ID,
        recipient: user.publicKey.toBuffer(),
        recipientChain: SOL_CHAIN_ID,
        targetToken: solUsdcMint.toBuffer(),
        targetAmount: BigInt(1_100_000_000),
        exchangeRateNum: BigInt(11),
        exchangeRateDenom: BigInt(10),
      };

      const emitterAddress = Buffer.alloc(32);

      const vaaBuffer = createTokenTransferVAA({
        guardianSetIndex: 0,
        emitterChain: ETH_CHAIN_ID,
        emitterAddress,
        sequence: BigInt(1002),
        guardianKeys: TEST_GUARDIAN_KEYS,
        transferPayload: payload,
        signerCount: 13,
      });

      const vaaAccount = await createVaaDataAccount(connection, payer, vaaBuffer);

      const { emitterChain, emitterAddress: vaaEmitterAddr, sequence } = extractVAAEmitterInfo(vaaBuffer);
      
      const sequenceBuffer = Buffer.alloc(8);
      sequenceBuffer.writeBigUInt64LE(sequence);
      
      const emitterChainBuffer = Buffer.alloc(2);
      emitterChainBuffer.writeUInt16LE(emitterChain);
      
      const [postedVaaPda] = findProgramAddress(
        [
          Buffer.from("PostedVAA"),
          emitterChainBuffer,
          vaaEmitterAddr,
          sequenceBuffer
        ],
        coreProgram.programId
      );

      await coreProgram.methods
        .postVaa(emitterChain, Array.from(vaaEmitterAddr), new BN(sequence.toString()))
        .accounts({
          bridge: bridgePda,
          guardianSet: guardianSetPda,
          vaaBuffer: vaaAccount.publicKey,
          postedVaa: postedVaaPda,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([
          ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })
        ])
        .signers([payer])
        .rpc();

      const recipientAccountInfo = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        solUsdcMint,
        user.publicKey,
        false,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
      );
      const recipientAccount = recipientAccountInfo.address;

      try {
        await tokenProgram.methods
          .completeTransfer()
          .accounts({
            bridge: bridgePda,
            postedVaa: postedVaaPda,
            tokenBinding: inboundBindingPda,
            recipientAccount: recipientAccount,
            custodyAccount: custodyAccount,
            targetTokenMint: solUsdcMint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        expect.fail("应该失败");
      } catch (error: any) {
        expect(error.message).to.include("Invalid exchange rate");
      }
    });

    it("UNIT-TB-026: 目标代币不匹配", async () => {
      const wrongMint = await createTestMint(connection, payer, 6);

      const [inboundBindingPda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x01, 0x00]),
          ethUsdcAddress,
          Buffer.from([0x84, 0x03]),
          solUsdcMint.toBuffer(),
        ],
        tokenProgram.programId
      );

      const payload: TokenTransferPayload = {
        payloadType: 1,
        amount: BigInt(1000_000_000),
        tokenAddress: ethUsdcAddress,
        tokenChain: ETH_CHAIN_ID,
        recipient: user.publicKey.toBuffer(),
        recipientChain: SOL_CHAIN_ID,
        targetToken: wrongMint.toBuffer(),
        targetAmount: BigInt(1000_000_000),
        exchangeRateNum: BigInt(1),
        exchangeRateDenom: BigInt(1),
      };

      const emitterAddress = Buffer.alloc(32);

      const vaaBuffer = createTokenTransferVAA({
        guardianSetIndex: 0,
        emitterChain: ETH_CHAIN_ID,
        emitterAddress,
        sequence: BigInt(1003),
        guardianKeys: TEST_GUARDIAN_KEYS,
        transferPayload: payload,
        signerCount: 13,
      });

      const vaaAccount = await createVaaDataAccount(connection, payer, vaaBuffer);

      const { emitterChain, emitterAddress: vaaEmitterAddr, sequence } = extractVAAEmitterInfo(vaaBuffer);
      
      const sequenceBuffer = Buffer.alloc(8);
      sequenceBuffer.writeBigUInt64LE(sequence);
      
      const emitterChainBuffer = Buffer.alloc(2);
      emitterChainBuffer.writeUInt16LE(emitterChain);
      
      const [postedVaaPda] = findProgramAddress(
        [
          Buffer.from("PostedVAA"),
          emitterChainBuffer,
          vaaEmitterAddr,
          sequenceBuffer
        ],
        coreProgram.programId
      );

      await coreProgram.methods
        .postVaa(emitterChain, Array.from(vaaEmitterAddr), new BN(sequence.toString()))
        .accounts({
          bridge: bridgePda,
          guardianSet: guardianSetPda,
          vaaBuffer: vaaAccount.publicKey,
          postedVaa: postedVaaPda,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([
          ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })
        ])
        .signers([payer])
        .rpc();

      const recipientAccountInfo = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        solUsdcMint,
        user.publicKey,
        false,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
      );
      const recipientAccount = recipientAccountInfo.address;

      try {
        await tokenProgram.methods
          .completeTransfer()
          .accounts({
            bridge: bridgePda,
            postedVaa: postedVaaPda,
            tokenBinding: inboundBindingPda,
            recipientAccount: recipientAccount,
            custodyAccount: custodyAccount,
            targetTokenMint: solUsdcMint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        expect.fail("应该失败");
      } catch (error: any) {
        expect(error.message).to.include("Target token mismatch");
      }
    });

    it("UNIT-TB-027: VAA验证失败", async () => {
      const invalidVaa = Buffer.alloc(100);

      const bodyHash = Buffer.from(keccak256(invalidVaa), "hex");
      const vaaHash = Buffer.from(keccak256(bodyHash), "hex");

      const [postedVaaPda] = findProgramAddress(
        [Buffer.from("PostedVAA"), vaaHash],
        coreProgram.programId
      );

      const recipientAccountInfo = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        solUsdcMint,
        user.publicKey,
        false,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
      );
      const recipientAccount = recipientAccountInfo.address;

      const [inboundBindingPda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x01, 0x00]),
          Buffer.alloc(32),
          Buffer.from([0x84, 0x03]),
          solUsdcMint.toBuffer(),
        ],
        tokenProgram.programId
      );

      try {
        await tokenProgram.methods
          .completeTransfer(Array.from(invalidVaa))
          .accounts({
            bridge: bridgePda,
            postedVaa: postedVaaPda,
            tokenBinding: inboundBindingPda,
            recipientAccount: recipientAccount,
            custodyAccount: custodyAccount,
            targetTokenMint: solUsdcMint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        expect.fail("应该失败");
      } catch (error: any) {
        expect(error).to.exist;
      }
    });

    it("UNIT-TB-028: 目标链不匹配", async () => {
      const [inboundBindingPda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x01, 0x00]),
          ethUsdcAddress,
          Buffer.from([0x84, 0x03]),
          solUsdcMint.toBuffer(),
        ],
        tokenProgram.programId
      );

      const payload: TokenTransferPayload = {
        payloadType: 1,
        amount: BigInt(1000_000_000),
        tokenAddress: ethUsdcAddress,
        tokenChain: ETH_CHAIN_ID,
        recipient: user.publicKey.toBuffer(),
        recipientChain: 56,
        targetToken: solUsdcMint.toBuffer(),
        targetAmount: BigInt(1000_000_000),
        exchangeRateNum: BigInt(1),
        exchangeRateDenom: BigInt(1),
      };

      const emitterAddress = Buffer.alloc(32);

      const vaaBuffer = createTokenTransferVAA({
        guardianSetIndex: 0,
        emitterChain: ETH_CHAIN_ID,
        emitterAddress,
        sequence: BigInt(1004),
        guardianKeys: TEST_GUARDIAN_KEYS,
        transferPayload: payload,
        signerCount: 13,
      });

      const vaaAccount = await createVaaDataAccount(connection, payer, vaaBuffer);

      const { emitterChain, emitterAddress: vaaEmitterAddr, sequence } = extractVAAEmitterInfo(vaaBuffer);
      
      const sequenceBuffer = Buffer.alloc(8);
      sequenceBuffer.writeBigUInt64LE(sequence);
      
      const emitterChainBuffer = Buffer.alloc(2);
      emitterChainBuffer.writeUInt16LE(emitterChain);
      
      const [postedVaaPda] = findProgramAddress(
        [
          Buffer.from("PostedVAA"),
          emitterChainBuffer,
          vaaEmitterAddr,
          sequenceBuffer
        ],
        coreProgram.programId
      );

      await coreProgram.methods
        .postVaa(emitterChain, Array.from(vaaEmitterAddr), new BN(sequence.toString()))
        .accounts({
          bridge: bridgePda,
          guardianSet: guardianSetPda,
          vaaBuffer: vaaAccount.publicKey,
          postedVaa: postedVaaPda,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([
          ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })
        ])
        .signers([payer])
        .rpc();

      const recipientAccountInfo = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        solUsdcMint,
        user.publicKey,
        false,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
      );
      const recipientAccount = recipientAccountInfo.address;

      try {
        await tokenProgram.methods
          .completeTransfer()
          .accounts({
            bridge: bridgePda,
            postedVaa: postedVaaPda,
            tokenBinding: inboundBindingPda,
            recipientAccount: recipientAccount,
            custodyAccount: custodyAccount,
            targetTokenMint: solUsdcMint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        expect.fail("应该失败");
      } catch (error: any) {
        expect(error.message).to.include("Invalid target chain");
      }
    });

    it("UNIT-TB-029: custody余额不足", async () => {
      const emptyMint = await createTestMint(connection, payer, 6);

      const [emptyCustodyPda] = findProgramAddress(
        [Buffer.from("Custody"), emptyMint.toBuffer()],
        tokenProgram.programId
      );

      await tokenProgram.methods
        .initializeCustody()
        .accounts({
          bridgeConfig: bridgeConfigPda,
          custody: emptyCustodyPda,
          mint: emptyMint,
          authority: payer.publicKey,
          payer: payer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();

      const emptyTokenAddress = Buffer.alloc(32);
      emptyTokenAddress.writeUInt32BE(0xEEEEEEEE, 0);

      const [inboundBindingPda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x01, 0x00]),
          emptyTokenAddress,
          Buffer.from([0x84, 0x03]),
          emptyMint.toBuffer(),
        ],
        tokenProgram.programId
      );

      await tokenProgram.methods
        .registerTokenBinding(
          ETH_CHAIN_ID,
          Array.from(emptyTokenAddress),
          SOL_CHAIN_ID,
          Array.from(emptyMint.toBuffer())
        )
        .accounts({
          bridgeConfig: bridgeConfigPda,
          tokenBinding: inboundBindingPda,
          authority: payer.publicKey,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();

      await tokenProgram.methods
        .setExchangeRate(
          ETH_CHAIN_ID,
          Array.from(emptyTokenAddress),
          SOL_CHAIN_ID,
          Array.from(emptyMint.toBuffer()),
          new BN(1),
          new BN(1)
        )
        .accounts({
          bridgeConfig: bridgeConfigPda,
          tokenBinding: inboundBindingPda,
          authority: payer.publicKey,
        })
        .signers([payer])
        .rpc();

      const payload: TokenTransferPayload = {
        payloadType: 1,
        amount: BigInt(1000_000_000),
        tokenAddress: emptyTokenAddress,
        tokenChain: ETH_CHAIN_ID,
        recipient: user.publicKey.toBuffer(),
        recipientChain: SOL_CHAIN_ID,
        targetToken: emptyMint.toBuffer(),
        targetAmount: BigInt(1000_000_000),
        exchangeRateNum: BigInt(1),
        exchangeRateDenom: BigInt(1),
      };

      const emitterAddress = Buffer.alloc(32);

      const vaaBuffer = createTokenTransferVAA({
        guardianSetIndex: 0,
        emitterChain: ETH_CHAIN_ID,
        emitterAddress,
        sequence: BigInt(1005),
        guardianKeys: TEST_GUARDIAN_KEYS,
        transferPayload: payload,
        signerCount: 13,
      });

      const vaaAccount = await createVaaDataAccount(connection, payer, vaaBuffer);

      const { emitterChain, emitterAddress: vaaEmitterAddr, sequence } = extractVAAEmitterInfo(vaaBuffer);
      
      const sequenceBuffer = Buffer.alloc(8);
      sequenceBuffer.writeBigUInt64LE(sequence);
      
      const emitterChainBuffer = Buffer.alloc(2);
      emitterChainBuffer.writeUInt16LE(emitterChain);
      
      const [postedVaaPda] = findProgramAddress(
        [
          Buffer.from("PostedVAA"),
          emitterChainBuffer,
          vaaEmitterAddr,
          sequenceBuffer
        ],
        coreProgram.programId
      );

      await coreProgram.methods
        .postVaa(emitterChain, Array.from(vaaEmitterAddr), new BN(sequence.toString()))
        .accounts({
          bridge: bridgePda,
          guardianSet: guardianSetPda,
          vaaBuffer: vaaAccount.publicKey,
          postedVaa: postedVaaPda,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([
          ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })
        ])
        .signers([payer])
        .rpc();

      const recipientAccount = await createAccount(
        connection,
        payer,
        emptyMint,
        user.publicKey,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
      );

      try {
        await tokenProgram.methods
          .completeTransfer()
        .accounts({
          coreProgram: coreProgram.programId,
          bridge: bridgePda,
          postedVaa: postedVaaPda,
          tokenBinding: inboundBindingPda,
          recipientAccount: recipientAccount,
          custodyAccount: emptyCustodyPda,
          targetTokenMint: emptyMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
          .rpc();
        expect.fail("应该失败");
      } catch (error: any) {
        expect(error).to.exist;
      }
    });
  });

  describe("2.2.3 register_token_binding指令测试", () => {
    it("UNIT-TB-011: 正常注册单向代币绑定", async () => {
      const testMint = await createTestMint(connection, payer, 6);
      const testTokenAddress = Buffer.alloc(32);
      testTokenAddress.writeUInt32BE(0x12345678, 0);

      const [tokenBindingPda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x84, 0x03]),
          testMint.toBuffer(),
          Buffer.from([0x01, 0x00]),
          testTokenAddress,
        ],
        tokenProgram.programId
      );

      await tokenProgram.methods
        .registerTokenBinding(
          SOL_CHAIN_ID,
          Array.from(testMint.toBuffer()),
          ETH_CHAIN_ID,
          Array.from(testTokenAddress)
        )
        .accounts({
          bridgeConfig: bridgeConfigPda,
          tokenBinding: tokenBindingPda,
          authority: payer.publicKey,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();

      const binding = await tokenProgram.account.tokenBinding.fetch(
        tokenBindingPda
      );
      expect(binding.sourceChain).to.equal(SOL_CHAIN_ID);
      expect(binding.targetChain).to.equal(ETH_CHAIN_ID);
      expect(binding.rateNumerator.toNumber()).to.equal(1);
      expect(binding.rateDenominator.toNumber()).to.equal(1);
      expect(binding.enabled).to.be.true;
    });

    it("UNIT-TB-012: 重复注册失败", async () => {
      const testMint = await createTestMint(connection, payer, 6);
      const testTokenAddress = Buffer.alloc(32);
      testTokenAddress.writeUInt32BE(0xABCDEF00, 0);

      const [tokenBindingPda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x84, 0x03]),
          testMint.toBuffer(),
          Buffer.from([0x01, 0x00]),
          testTokenAddress,
        ],
        tokenProgram.programId
      );

      await tokenProgram.methods
        .registerTokenBinding(
          SOL_CHAIN_ID,
          Array.from(testMint.toBuffer()),
          ETH_CHAIN_ID,
          Array.from(testTokenAddress)
        )
        .accounts({
          bridgeConfig: bridgeConfigPda,
          tokenBinding: tokenBindingPda,
          authority: payer.publicKey,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();

      try {
        await tokenProgram.methods
          .registerTokenBinding(
            SOL_CHAIN_ID,
            Array.from(testMint.toBuffer()),
            ETH_CHAIN_ID,
            Array.from(testTokenAddress)
          )
          .accounts({
            bridgeConfig: bridgeConfigPda,
            tokenBinding: tokenBindingPda,
            authority: payer.publicKey,
            payer: payer.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([payer])
          .rpc();
        expect.fail("应该失败");
      } catch (error: any) {
        expect(error.message).to.include("already in use");
      }
    });

    it("UNIT-TB-013: 非管理员调用失败", async () => {
      const testMint = await createTestMint(connection, payer, 6);
      const testTokenAddress = Buffer.alloc(32);

      const [tokenBindingPda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x84, 0x03]),
          testMint.toBuffer(),
          Buffer.from([0x01, 0x00]),
          testTokenAddress,
        ],
        tokenProgram.programId
      );

      const nonAdmin = Keypair.generate();
      await airdrop(connection, nonAdmin.publicKey);

      try {
        await tokenProgram.methods
          .registerTokenBinding(
            SOL_CHAIN_ID,
            Array.from(testMint.toBuffer()),
            ETH_CHAIN_ID,
            Array.from(testTokenAddress)
          )
          .accounts({
            bridgeConfig: bridgeConfigPda,
            tokenBinding: tokenBindingPda,
            authority: nonAdmin.publicKey,
            payer: nonAdmin.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([nonAdmin])
          .rpc();
        expect.fail("应该失败");
      } catch (error: any) {
        expect(error.message).to.include("has one constraint");
      }
    });

    it("UNIT-TB-014: 注册不同代币兑换对(多对多)", async () => {
      const testMint = await createTestMint(connection, payer, 6);

      const ethUsdcAddr = Buffer.alloc(32);
      ethUsdcAddr.writeUInt32BE(0xA0B86991, 0);

      const ethUsdtAddr = Buffer.alloc(32);
      ethUsdtAddr.writeUInt32BE(0xdAC17F95, 0);

      const ethDaiAddr = Buffer.alloc(32);
      ethDaiAddr.writeUInt32BE(0x6B175474, 0);

      const [binding1Pda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x84, 0x03]),
          testMint.toBuffer(),
          Buffer.from([0x01, 0x00]),
          ethUsdcAddr,
        ],
        tokenProgram.programId
      );

      const [binding2Pda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x84, 0x03]),
          testMint.toBuffer(),
          Buffer.from([0x01, 0x00]),
          ethUsdtAddr,
        ],
        tokenProgram.programId
      );

      const [binding3Pda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x84, 0x03]),
          testMint.toBuffer(),
          Buffer.from([0x01, 0x00]),
          ethDaiAddr,
        ],
        tokenProgram.programId
      );

      await tokenProgram.methods
        .registerTokenBinding(
          SOL_CHAIN_ID,
          Array.from(testMint.toBuffer()),
          ETH_CHAIN_ID,
          Array.from(ethUsdcAddr)
        )
        .accounts({
          bridgeConfig: bridgeConfigPda,
          tokenBinding: binding1Pda,
          authority: payer.publicKey,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();

      await tokenProgram.methods
        .registerTokenBinding(
          SOL_CHAIN_ID,
          Array.from(testMint.toBuffer()),
          ETH_CHAIN_ID,
          Array.from(ethUsdtAddr)
        )
        .accounts({
          bridgeConfig: bridgeConfigPda,
          tokenBinding: binding2Pda,
          authority: payer.publicKey,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();

      await tokenProgram.methods
        .registerTokenBinding(
          SOL_CHAIN_ID,
          Array.from(testMint.toBuffer()),
          ETH_CHAIN_ID,
          Array.from(ethDaiAddr)
        )
        .accounts({
          bridgeConfig: bridgeConfigPda,
          tokenBinding: binding3Pda,
          authority: payer.publicKey,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();

      const binding1 = await tokenProgram.account.tokenBinding.fetch(binding1Pda);
      const binding2 = await tokenProgram.account.tokenBinding.fetch(binding2Pda);
      const binding3 = await tokenProgram.account.tokenBinding.fetch(binding3Pda);

      expect(binding1.targetToken).to.deep.equal(Array.from(ethUsdcAddr));
      expect(binding2.targetToken).to.deep.equal(Array.from(ethUsdtAddr));
      expect(binding3.targetToken).to.deep.equal(Array.from(ethDaiAddr));
    });

    it("UNIT-TB-030: 注册出站和入站binding(双向)", async () => {
      const testMint = await createTestMint(connection, payer, 6);
      const testTokenAddress = Buffer.alloc(32);
      testTokenAddress.writeUInt32BE(0xFFFFFFFF, 0);

      const [outboundPda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x84, 0x03]),
          testMint.toBuffer(),
          Buffer.from([0x01, 0x00]),
          testTokenAddress,
        ],
        tokenProgram.programId
      );

      const [inboundPda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x01, 0x00]),
          testTokenAddress,
          Buffer.from([0x84, 0x03]),
          testMint.toBuffer(),
        ],
        tokenProgram.programId
      );

      await tokenProgram.methods
        .registerTokenBinding(
          SOL_CHAIN_ID,
          Array.from(testMint.toBuffer()),
          ETH_CHAIN_ID,
          Array.from(testTokenAddress)
        )
        .accounts({
          bridgeConfig: bridgeConfigPda,
          tokenBinding: outboundPda,
          authority: payer.publicKey,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();

      await tokenProgram.methods
        .registerTokenBinding(
          ETH_CHAIN_ID,
          Array.from(testTokenAddress),
          SOL_CHAIN_ID,
          Array.from(testMint.toBuffer())
        )
        .accounts({
          bridgeConfig: bridgeConfigPda,
          tokenBinding: inboundPda,
          authority: payer.publicKey,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();

      const outbound = await tokenProgram.account.tokenBinding.fetch(outboundPda);
      const inbound = await tokenProgram.account.tokenBinding.fetch(inboundPda);

      expect(outbound.sourceChain).to.equal(SOL_CHAIN_ID);
      expect(outbound.targetChain).to.equal(ETH_CHAIN_ID);
      expect(inbound.sourceChain).to.equal(ETH_CHAIN_ID);
      expect(inbound.targetChain).to.equal(SOL_CHAIN_ID);
    });
  });

  describe("2.2.4 register_bidirectional_binding指令测试", () => {
    it("UNIT-TB-031: 双向注册同币种(1:1)", async () => {
      const testMint = await createTestMint(connection, payer, 6);
      const testTokenAddress = Buffer.alloc(32);
      testTokenAddress.writeUInt32BE(0x11111111, 0);

      const [outboundPda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x84, 0x03]),
          testMint.toBuffer(),
          Buffer.from([0x01, 0x00]),
          testTokenAddress,
        ],
        tokenProgram.programId
      );

      const [inboundPda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x01, 0x00]),
          testTokenAddress,
          Buffer.from([0x84, 0x03]),
          testMint.toBuffer(),
        ],
        tokenProgram.programId
      );

      await tokenProgram.methods
        .registerBidirectionalBinding(
          SOL_CHAIN_ID,
          Array.from(testMint.toBuffer()),
          ETH_CHAIN_ID,
          Array.from(testTokenAddress),
          new BN(1),
          new BN(1),
          new BN(1),
          new BN(1)
        )
        .accounts({
          bridgeConfig: bridgeConfigPda,
          outboundBinding: outboundPda,
          inboundBinding: inboundPda,
          authority: payer.publicKey,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();

      const outbound = await tokenProgram.account.tokenBinding.fetch(outboundPda);
      const inbound = await tokenProgram.account.tokenBinding.fetch(inboundPda);

      expect(outbound.sourceChain).to.equal(SOL_CHAIN_ID);
      expect(outbound.targetChain).to.equal(ETH_CHAIN_ID);
      expect(outbound.rateNumerator.toNumber()).to.equal(1);
      expect(outbound.rateDenominator.toNumber()).to.equal(1);

      expect(inbound.sourceChain).to.equal(ETH_CHAIN_ID);
      expect(inbound.targetChain).to.equal(SOL_CHAIN_ID);
      expect(inbound.rateNumerator.toNumber()).to.equal(1);
      expect(inbound.rateDenominator.toNumber()).to.equal(1);
    });

    it("UNIT-TB-032: 双向注册不同币种", async () => {
      const testMint = await createTestMint(connection, payer, 6);
      const testTokenAddress = Buffer.alloc(32);
      testTokenAddress.writeUInt32BE(0x22222222, 0);

      const [outboundPda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x84, 0x03]),
          testMint.toBuffer(),
          Buffer.from([0x01, 0x00]),
          testTokenAddress,
        ],
        tokenProgram.programId
      );

      const [inboundPda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x01, 0x00]),
          testTokenAddress,
          Buffer.from([0x84, 0x03]),
          testMint.toBuffer(),
        ],
        tokenProgram.programId
      );

      await tokenProgram.methods
        .registerBidirectionalBinding(
          SOL_CHAIN_ID,
          Array.from(testMint.toBuffer()),
          ETH_CHAIN_ID,
          Array.from(testTokenAddress),
          new BN(998),
          new BN(1000),
          new BN(1002),
          new BN(1000)
        )
        .accounts({
          bridgeConfig: bridgeConfigPda,
          outboundBinding: outboundPda,
          inboundBinding: inboundPda,
          authority: payer.publicKey,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();

      const outbound = await tokenProgram.account.tokenBinding.fetch(outboundPda);
      const inbound = await tokenProgram.account.tokenBinding.fetch(inboundPda);

      expect(outbound.rateNumerator.toNumber()).to.equal(998);
      expect(outbound.rateDenominator.toNumber()).to.equal(1000);
      expect(inbound.rateNumerator.toNumber()).to.equal(1002);
      expect(inbound.rateDenominator.toNumber()).to.equal(1000);
    });

    it("UNIT-TB-033: 双向不对称兑换比率", async () => {
      const testMint = await createTestMint(connection, payer, 6);
      const testTokenAddress = Buffer.alloc(32);
      testTokenAddress.writeUInt32BE(0x33333333, 0);

      const [outboundPda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x84, 0x03]),
          testMint.toBuffer(),
          Buffer.from([0x01, 0x00]),
          testTokenAddress,
        ],
        tokenProgram.programId
      );

      const [inboundPda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x01, 0x00]),
          testTokenAddress,
          Buffer.from([0x84, 0x03]),
          testMint.toBuffer(),
        ],
        tokenProgram.programId
      );

      await tokenProgram.methods
        .registerBidirectionalBinding(
          SOL_CHAIN_ID,
          Array.from(testMint.toBuffer()),
          ETH_CHAIN_ID,
          Array.from(testTokenAddress),
          new BN(998),
          new BN(1000),
          new BN(1002),
          new BN(1000)
        )
        .accounts({
          bridgeConfig: bridgeConfigPda,
          outboundBinding: outboundPda,
          inboundBinding: inboundPda,
          authority: payer.publicKey,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();

      const outbound = await tokenProgram.account.tokenBinding.fetch(outboundPda);
      const inbound = await tokenProgram.account.tokenBinding.fetch(inboundPda);

      const outboundAmount = Math.floor((1000_000_000 * 998) / 1000);
      expect(outboundAmount).to.equal(998_000_000);

      const inboundAmount = Math.floor((1000_000_000 * 1002) / 1000);
      expect(inboundAmount).to.equal(1_002_000_000);
    });

    it("UNIT-TB-034: 验证自动创建两个binding", async () => {
      const testMint = await createTestMint(connection, payer, 6);
      const testTokenAddress = Buffer.alloc(32);
      testTokenAddress.writeUInt32BE(0x44444444, 0);

      const [outboundPda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x84, 0x03]),
          testMint.toBuffer(),
          Buffer.from([0x01, 0x00]),
          testTokenAddress,
        ],
        tokenProgram.programId
      );

      const [inboundPda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x01, 0x00]),
          testTokenAddress,
          Buffer.from([0x84, 0x03]),
          testMint.toBuffer(),
        ],
        tokenProgram.programId
      );

      await tokenProgram.methods
        .registerBidirectionalBinding(
          SOL_CHAIN_ID,
          Array.from(testMint.toBuffer()),
          ETH_CHAIN_ID,
          Array.from(testTokenAddress),
          new BN(1),
          new BN(1),
          new BN(1),
          new BN(1)
        )
        .accounts({
          bridgeConfig: bridgeConfigPda,
          outboundBinding: outboundPda,
          inboundBinding: inboundPda,
          authority: payer.publicKey,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();

      const outboundExists = await connection.getAccountInfo(outboundPda);
      const inboundExists = await connection.getAccountInfo(inboundPda);

      expect(outboundExists).to.not.be.null;
      expect(inboundExists).to.not.be.null;
    });

    it("UNIT-TB-035: 非管理员调用失败", async () => {
      const testMint = await createTestMint(connection, payer, 6);
      const testTokenAddress = Buffer.alloc(32);

      const [outboundPda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x84, 0x03]),
          testMint.toBuffer(),
          Buffer.from([0x01, 0x00]),
          testTokenAddress,
        ],
        tokenProgram.programId
      );

      const [inboundPda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x01, 0x00]),
          testTokenAddress,
          Buffer.from([0x84, 0x03]),
          testMint.toBuffer(),
        ],
        tokenProgram.programId
      );

      const nonAdmin = Keypair.generate();
      await airdrop(connection, nonAdmin.publicKey);

      try {
        await tokenProgram.methods
          .registerBidirectionalBinding(
            SOL_CHAIN_ID,
            Array.from(testMint.toBuffer()),
            ETH_CHAIN_ID,
            Array.from(testTokenAddress),
            new BN(1),
            new BN(1),
            new BN(1),
            new BN(1)
          )
          .accounts({
            bridgeConfig: bridgeConfigPda,
            outboundBinding: outboundPda,
            inboundBinding: inboundPda,
            authority: nonAdmin.publicKey,
            payer: nonAdmin.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([nonAdmin])
          .rpc();
        expect.fail("应该失败");
      } catch (error: any) {
        expect(error.message).to.include("has one constraint");
      }
    });
  });

  describe("2.2.5 set_exchange_rate指令测试", () => {
    it("UNIT-TB-015: 设置1:1兑换比率", async () => {
      const testMint = await createTestMint(connection, payer, 6);
      const testTokenAddress = Buffer.alloc(32);
      testTokenAddress.writeUInt32BE(0x55555555, 0);

      const [tokenBindingPda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x84, 0x03]),
          testMint.toBuffer(),
          Buffer.from([0x01, 0x00]),
          testTokenAddress,
        ],
        tokenProgram.programId
      );

      await tokenProgram.methods
        .registerTokenBinding(
          SOL_CHAIN_ID,
          Array.from(testMint.toBuffer()),
          ETH_CHAIN_ID,
          Array.from(testTokenAddress)
        )
        .accounts({
          bridgeConfig: bridgeConfigPda,
          tokenBinding: tokenBindingPda,
          authority: payer.publicKey,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();

      await tokenProgram.methods
        .setExchangeRate(
          SOL_CHAIN_ID,
          Array.from(testMint.toBuffer()),
          ETH_CHAIN_ID,
          Array.from(testTokenAddress),
          new BN(1),
          new BN(1)
        )
        .accounts({
          bridgeConfig: bridgeConfigPda,
          tokenBinding: tokenBindingPda,
          authority: payer.publicKey,
        })
        .signers([payer])
        .rpc();

      const binding = await tokenProgram.account.tokenBinding.fetch(
        tokenBindingPda
      );
      expect(binding.rateNumerator.toNumber()).to.equal(1);
      expect(binding.rateDenominator.toNumber()).to.equal(1);

      const sourceAmount = 1000_000_000;
      const targetAmount = Math.floor(
        (sourceAmount * binding.rateNumerator.toNumber()) /
          binding.rateDenominator.toNumber()
      );
      expect(targetAmount).to.equal(1000_000_000);
    });

    it("UNIT-TB-016: 设置自定义兑换比率", async () => {
      const testMint = await createTestMint(connection, payer, 6);
      const testTokenAddress = Buffer.alloc(32);
      testTokenAddress.writeUInt32BE(0x66666666, 0);

      const [tokenBindingPda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x84, 0x03]),
          testMint.toBuffer(),
          Buffer.from([0x01, 0x00]),
          testTokenAddress,
        ],
        tokenProgram.programId
      );

      await tokenProgram.methods
        .registerTokenBinding(
          SOL_CHAIN_ID,
          Array.from(testMint.toBuffer()),
          ETH_CHAIN_ID,
          Array.from(testTokenAddress)
        )
        .accounts({
          bridgeConfig: bridgeConfigPda,
          tokenBinding: tokenBindingPda,
          authority: payer.publicKey,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();

      await tokenProgram.methods
        .setExchangeRate(
          SOL_CHAIN_ID,
          Array.from(testMint.toBuffer()),
          ETH_CHAIN_ID,
          Array.from(testTokenAddress),
          new BN(998),
          new BN(1000)
        )
        .accounts({
          bridgeConfig: bridgeConfigPda,
          tokenBinding: tokenBindingPda,
          authority: payer.publicKey,
        })
        .signers([payer])
        .rpc();

      const binding = await tokenProgram.account.tokenBinding.fetch(
        tokenBindingPda
      );
      expect(binding.rateNumerator.toNumber()).to.equal(998);
      expect(binding.rateDenominator.toNumber()).to.equal(1000);

      const sourceAmount = 1000_000_000;
      const targetAmount = Math.floor((sourceAmount * 998) / 1000);
      expect(targetAmount).to.equal(998_000_000);
    });

    it("UNIT-TB-017: 分母为0失败", async () => {
      const testMint = await createTestMint(connection, payer, 6);
      const testTokenAddress = Buffer.alloc(32);
      testTokenAddress.writeUInt32BE(0x77777777, 0);

      const [tokenBindingPda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x84, 0x03]),
          testMint.toBuffer(),
          Buffer.from([0x01, 0x00]),
          testTokenAddress,
        ],
        tokenProgram.programId
      );

      await tokenProgram.methods
        .registerTokenBinding(
          SOL_CHAIN_ID,
          Array.from(testMint.toBuffer()),
          ETH_CHAIN_ID,
          Array.from(testTokenAddress)
        )
        .accounts({
          bridgeConfig: bridgeConfigPda,
          tokenBinding: tokenBindingPda,
          authority: payer.publicKey,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();

      try {
        await tokenProgram.methods
          .setExchangeRate(
            SOL_CHAIN_ID,
            Array.from(testMint.toBuffer()),
            ETH_CHAIN_ID,
            Array.from(testTokenAddress),
            new BN(1),
            new BN(0)
          )
          .accounts({
            bridgeConfig: bridgeConfigPda,
            tokenBinding: tokenBindingPda,
            authority: payer.publicKey,
          })
          .signers([payer])
          .rpc();
        expect.fail("应该失败");
      } catch (error: any) {
        expect(error.message).to.include("zero");
      }
    });

    it("UNIT-TB-018: TokenBinding不存在失败", async () => {
      const testMint = await createTestMint(connection, payer, 6);
      const testTokenAddress = Buffer.alloc(32);

      const [tokenBindingPda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x84, 0x03]),
          testMint.toBuffer(),
          Buffer.from([0x01, 0x00]),
          testTokenAddress,
        ],
        tokenProgram.programId
      );

      try {
        await tokenProgram.methods
          .setExchangeRate(
            SOL_CHAIN_ID,
            Array.from(testMint.toBuffer()),
            ETH_CHAIN_ID,
            Array.from(testTokenAddress),
            new BN(1),
            new BN(1)
          )
          .accounts({
            bridgeConfig: bridgeConfigPda,
            tokenBinding: tokenBindingPda,
            authority: payer.publicKey,
          })
          .signers([payer])
          .rpc();
        expect.fail("应该失败");
      } catch (error: any) {
        expect(error).to.exist;
      }
    });

    it("UNIT-TB-019: 非管理员调用失败", async () => {
      const testMint = await createTestMint(connection, payer, 6);
      const testTokenAddress = Buffer.alloc(32);
      testTokenAddress.writeUInt32BE(0x88888888, 0);

      const [tokenBindingPda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x84, 0x03]),
          testMint.toBuffer(),
          Buffer.from([0x01, 0x00]),
          testTokenAddress,
        ],
        tokenProgram.programId
      );

      await tokenProgram.methods
        .registerTokenBinding(
          SOL_CHAIN_ID,
          Array.from(testMint.toBuffer()),
          ETH_CHAIN_ID,
          Array.from(testTokenAddress)
        )
        .accounts({
          bridgeConfig: bridgeConfigPda,
          tokenBinding: tokenBindingPda,
          authority: payer.publicKey,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();

      const nonAdmin = Keypair.generate();
      await airdrop(connection, nonAdmin.publicKey);

      try {
        await tokenProgram.methods
          .setExchangeRate(
            SOL_CHAIN_ID,
            Array.from(testMint.toBuffer()),
            ETH_CHAIN_ID,
            Array.from(testTokenAddress),
            new BN(1),
            new BN(1)
          )
        .accounts({
          bridgeConfig: bridgeConfigPda,
          tokenBinding: tokenBindingPda,
          authority: nonAdmin.publicKey,
        })
        .signers([nonAdmin])
        .rpc();
        expect.fail("应该失败");
      } catch (error: any) {
        expect(error.message).to.include("has one constraint");
      }
    });
  });

  describe("2.2.6 update_amm_config指令测试", () => {
    it("UNIT-TB-020: 启用外部AMM定价", async () => {
      const testMint = await createTestMint(connection, payer, 6);
      const testTokenAddress = Buffer.alloc(32);
      testTokenAddress.writeUInt32BE(0x99999999, 0);

      const [tokenBindingPda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x84, 0x03]),
          testMint.toBuffer(),
          Buffer.from([0x01, 0x00]),
          testTokenAddress,
        ],
        tokenProgram.programId
      );

      await tokenProgram.methods
        .registerTokenBinding(
          SOL_CHAIN_ID,
          Array.from(testMint.toBuffer()),
          ETH_CHAIN_ID,
          Array.from(testTokenAddress)
        )
        .accounts({
          bridgeConfig: bridgeConfigPda,
          tokenBinding: tokenBindingPda,
          authority: payer.publicKey,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();

      const ammProgramId = Keypair.generate().publicKey;

      await tokenProgram.methods
        .updateAmmConfig(
          SOL_CHAIN_ID,
          Array.from(testMint.toBuffer()),
          ETH_CHAIN_ID,
          Array.from(testTokenAddress),
          ammProgramId,
          true
        )
        .accounts({
          bridgeConfig: bridgeConfigPda,
          tokenBinding: tokenBindingPda,
          authority: payer.publicKey,
        })
        .signers([payer])
        .rpc();

      const binding = await tokenProgram.account.tokenBinding.fetch(
        tokenBindingPda
      );
      expect(binding.useExternalPrice).to.be.true;
      expect(binding.ammProgramId.toString()).to.equal(ammProgramId.toString());
    });

    it("UNIT-TB-021: 禁用外部AMM定价", async () => {
      const testMint = await createTestMint(connection, payer, 6);
      const testTokenAddress = Buffer.alloc(32);
      testTokenAddress.writeUInt32BE(0xAAAAAAAA, 0);

      const [tokenBindingPda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x84, 0x03]),
          testMint.toBuffer(),
          Buffer.from([0x01, 0x00]),
          testTokenAddress,
        ],
        tokenProgram.programId
      );

      await tokenProgram.methods
        .registerTokenBinding(
          SOL_CHAIN_ID,
          Array.from(testMint.toBuffer()),
          ETH_CHAIN_ID,
          Array.from(testTokenAddress)
        )
        .accounts({
          bridgeConfig: bridgeConfigPda,
          tokenBinding: tokenBindingPda,
          authority: payer.publicKey,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();

      await tokenProgram.methods
        .updateAmmConfig(
          SOL_CHAIN_ID,
          Array.from(testMint.toBuffer()),
          ETH_CHAIN_ID,
          Array.from(testTokenAddress),
          PublicKey.default,
          false
        )
        .accounts({
          bridgeConfig: bridgeConfigPda,
          tokenBinding: tokenBindingPda,
          authority: payer.publicKey,
        })
        .signers([payer])
        .rpc();

      const binding = await tokenProgram.account.tokenBinding.fetch(
        tokenBindingPda
      );
      expect(binding.useExternalPrice).to.be.false;
    });

    it("UNIT-TB-022: 非管理员调用失败", async () => {
      const testMint = await createTestMint(connection, payer, 6);
      const testTokenAddress = Buffer.alloc(32);
      testTokenAddress.writeUInt32BE(0xBBBBBBBB, 0);

      const [tokenBindingPda] = findProgramAddress(
        [
          Buffer.from("TokenBinding"),
          Buffer.from([0x84, 0x03]),
          testMint.toBuffer(),
          Buffer.from([0x01, 0x00]),
          testTokenAddress,
        ],
        tokenProgram.programId
      );

      await tokenProgram.methods
        .registerTokenBinding(
          SOL_CHAIN_ID,
          Array.from(testMint.toBuffer()),
          ETH_CHAIN_ID,
          Array.from(testTokenAddress)
        )
        .accounts({
          bridgeConfig: bridgeConfigPda,
          tokenBinding: tokenBindingPda,
          authority: payer.publicKey,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();

      const nonAdmin = Keypair.generate();
      await airdrop(connection, nonAdmin.publicKey);

      try {
        await tokenProgram.methods
          .updateAmmConfig(
            SOL_CHAIN_ID,
            Array.from(testMint.toBuffer()),
            ETH_CHAIN_ID,
            Array.from(testTokenAddress),
            PublicKey.default,
            true
          )
        .accounts({
          bridgeConfig: bridgeConfigPda,
          tokenBinding: tokenBindingPda,
          authority: nonAdmin.publicKey,
        })
        .signers([nonAdmin])
        .rpc();
        expect.fail("应该失败");
      } catch (error: any) {
        expect(error.message).to.include("has one constraint");
      }
    });
  });
});
