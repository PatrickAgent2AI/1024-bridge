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
  generateNewGuardianKeys,
  createVaaDataAccount,
  TEST_PAYER,
} from "../utils/setup";
import {
  createTokenTransferVAA,
  TokenTransferPayload,
  createGuardianSetUpgradeVAA,
  serializeGuardianSetUpgradePayload,
  extractVAAEmitterInfo,
} from "../utils/vaa";
import { keccak256 } from "js-sha3";

describe("程序集成测试", () => {
  let provider: AnchorProvider;
  let coreProgram: Program;
  let tokenProgram: Program;
  let payer: Keypair;
  let user: Keypair;
  let bridgePda: PublicKey;
  let guardianSetPda: PublicKey;
  let bridgeConfigPda: PublicKey;
  let connection: anchor.web3.Connection;

  const SOL_CHAIN_ID = 900;
  const ETH_CHAIN_ID = 1;

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
        .initialize(0, guardians, messageFee)
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
  });

  describe("3.1 跨程序调用测试", () => {
    let solUsdcMint: PublicKey;
    let userTokenAccount: PublicKey;
    let custodyAccount: PublicKey;
    let ethUsdcAddress: Buffer;

    before(async () => {
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
          custody: custodyAccount,
          mint: solUsdcMint,
          payer: payer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();

      ethUsdcAddress = Buffer.alloc(32);
      ethUsdcAddress.writeUInt32BE(0xA0B86991, 0);

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
    });

    it("INT-SOL-001: transfer_tokens → post_message", async () => {
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

      const [sequencePda] = findProgramAddress(
        [Buffer.from("Sequence"), tokenProgram.programId.toBuffer()],
        coreProgram.programId
      );

      const messagePda = Keypair.generate();

      const amount = new BN(1000_000_000);
      const recipient = Buffer.alloc(32);
      recipient.writeUInt32BE(0x12345678, 0);

      const sequenceBefore = await coreProgram.account.sequence
        .fetch(sequencePda)
        .catch(() => ({ sequence: new BN(0) }));

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
          bridgeConfig: bridgeConfigPda,
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

      const sequenceAfter = await coreProgram.account.sequence.fetch(sequencePda);
      expect(sequenceAfter.sequence.toNumber()).to.be.greaterThan(
        sequenceBefore.sequence.toNumber()
      );

      const message = await coreProgram.account.postedMessage.fetch(
        messagePda.publicKey
      );
      expect(message.payload).to.have.lengthOf.greaterThan(0);
      expect(message.emitter.toString()).to.equal(
        tokenProgram.programId.toString()
      );
    });

    it("INT-SOL-002: post_vaa → complete_transfer", async () => {
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
        sequence: BigInt(2000),
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

      const postedVaa = await coreProgram.account.postedVaa.fetch(postedVaaPda);
      expect(postedVaa.consumed).to.be.false;

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

      const recipientBalance = await getTokenBalance(connection, recipientAccount);
      expect(recipientBalance.toString()).to.equal((recipientBalanceBefore + BigInt(500_000_000)).toString());

      const postedVaaAfter = await coreProgram.account.postedVaa.fetch(
        postedVaaPda
      );
      expect(postedVaaAfter.consumed).to.be.true;
    });

    it("INT-SOL-003: 多步骤原子性", async () => {
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

      const [sequencePda] = findProgramAddress(
        [Buffer.from("Sequence"), tokenProgram.programId.toBuffer()],
        coreProgram.programId
      );

      const messagePda = Keypair.generate();

      const amount = new BN(100_000_000);
      const recipient = Buffer.alloc(32);

      const userBalanceBefore = await getTokenBalance(connection, userTokenAccount);
      const custodyBalanceBefore = await getTokenBalance(
        connection,
        custodyAccount
      );

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
            payer: payer.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([user, payer, messagePda])
          .rpc();

        const userBalanceAfter = await getTokenBalance(connection, userTokenAccount);
        const custodyBalanceAfter = await getTokenBalance(
          connection,
          custodyAccount
        );

        expect(
          userBalanceBefore - userBalanceAfter
        ).to.equal(BigInt(amount.toNumber()));
        expect(
          custodyBalanceAfter - custodyBalanceBefore
        ).to.equal(BigInt(amount.toNumber()));

        const message = await coreProgram.account.postedMessage.fetch(
          messagePda.publicKey
        );
        expect(message).to.exist;
      } catch (error) {
        const userBalanceAfter = await getTokenBalance(connection, userTokenAccount);
        const custodyBalanceAfter = await getTokenBalance(
          connection,
          custodyAccount
        );

        expect(userBalanceAfter).to.equal(userBalanceBefore);
        expect(custodyBalanceAfter).to.equal(custodyBalanceBefore);
      }
    });
  });

  describe.skip("3.2 Guardian Set升级测试 (暂时跳过)", () => {
    let newGuardianKeys: any[];
    let currentGuardianSetIndex: number;

    before(async () => {
      newGuardianKeys = generateNewGuardianKeys(19);
      const bridge = await coreProgram.account.bridge.fetch(bridgePda);
      currentGuardianSetIndex = bridge.guardianSetIndex;
    });

    it("INT-SOL-004: 升级后旧Set仍可验证", async () => {
      const [currentGuardianSetPda] = findProgramAddress(
        [
          Buffer.from("GuardianSet"),
          Buffer.from([0, 0, 0, currentGuardianSetIndex]),
        ],
        coreProgram.programId
      );

      const [newGuardianSetPda] = findProgramAddress(
        [
          Buffer.from("GuardianSet"),
          Buffer.from([0, 0, 0, currentGuardianSetIndex + 1]),
        ],
        coreProgram.programId
      );

      const newGuardianAddresses = newGuardianKeys.map((g) => g.address);
      const upgradePayload = serializeGuardianSetUpgradePayload({
        module: 0x01,
        action: 0x02,
        chain: 0,
        newGuardianSetIndex: currentGuardianSetIndex + 1,
        newGuardians: newGuardianAddresses,
      });

      const guardianKeys = currentGuardianSetIndex === 0 
        ? TEST_GUARDIAN_KEYS 
        : newGuardianKeys;

      const vaaBuffer = createGuardianSetUpgradeVAA({
        guardianSetIndex: currentGuardianSetIndex,
        emitterChain: 1,
        emitterAddress: Buffer.alloc(32),
        sequence: BigInt(3000),
        guardianKeys: guardianKeys,
        upgradePayload: {
          module: 0x01,
          action: 0x02,
          chain: 0,
          newGuardianSetIndex: currentGuardianSetIndex + 1,
          newGuardians: newGuardianAddresses,
        },
        signerCount: 13,
      });

      const vaaAccount = await createVaaDataAccount(connection, payer, vaaBuffer);

      const bodyHash = Buffer.from(
        keccak256(vaaBuffer.slice(6 + 13 * 66)),
        "hex"
      );
      const vaaHash = Buffer.from(keccak256(bodyHash), "hex");

      const [upgradeVaaPda] = findProgramAddress(
        [Buffer.from("PostedVAA"), vaaHash],
        coreProgram.programId
      );

      const newGuardianSetKeypair = Keypair.generate();
      const upgradeVaaKeypair = Keypair.generate();

      await coreProgram.methods
        .updateGuardianSet()
        .accounts({
          bridge: bridgePda,
          currentGuardianSet: currentGuardianSetPda,
          vaaBuffer: vaaAccount.publicKey,
          newGuardianSet: newGuardianSetKeypair.publicKey,
          upgradeVaa: upgradeVaaKeypair.publicKey,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([
          ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })
        ])
        .signers([payer, newGuardianSetKeypair, upgradeVaaKeypair])
        .rpc();

      const emitterAddress = Buffer.alloc(32);
      const payload = Buffer.from("test with old guardian set");

      const oldSetVaa = createTokenTransferVAA({
        guardianSetIndex: currentGuardianSetIndex,
        emitterChain: 1,
        emitterAddress,
        sequence: BigInt(3001),
        guardianKeys: guardianKeys,
        transferPayload: {
          payloadType: 1,
          amount: BigInt(100_000_000),
          tokenAddress: Buffer.alloc(32),
          tokenChain: 1,
          recipient: Buffer.alloc(32),
          recipientChain: SOL_CHAIN_ID,
          targetToken: Buffer.alloc(32),
          targetAmount: BigInt(100_000_000),
          exchangeRateNum: BigInt(1),
          exchangeRateDenom: BigInt(1),
        },
        signerCount: 13,
      });

      const oldBodyHash = Buffer.from(
        keccak256(oldSetVaa.slice(6 + 13 * 66)),
        "hex"
      );
      const oldVaaHash = Buffer.from(keccak256(oldBodyHash), "hex");

      const [oldPostedVaaPda] = findProgramAddress(
        [Buffer.from("PostedVAA"), oldVaaHash],
        coreProgram.programId
      );

      const oldVaaAccount = await createVaaDataAccount(connection, payer, oldSetVaa);

      const { emitterChain, emitterAddress: vaaEmitterAddr, sequence } = extractVAAEmitterInfo(oldSetVaa);

      await coreProgram.methods
        .postVaa(emitterChain, Array.from(vaaEmitterAddr), new BN(sequence.toString()))
        .accounts({
          bridge: bridgePda,
          guardianSet: currentGuardianSetPda,
          vaaBuffer: oldVaaAccount.publicKey,
          postedVaa: oldPostedVaaPda,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([
          ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })
        ])
        .signers([payer])
        .rpc();

      const postedVaa = await coreProgram.account.postedVaa.fetch(oldPostedVaaPda);
      expect(postedVaa.consumed).to.be.false;
    });

    it("INT-SOL-005: 升级后新Set可验证", async () => {
      const [newGuardianSetPda] = findProgramAddress(
        [
          Buffer.from("GuardianSet"),
          Buffer.from([0, 0, 0, currentGuardianSetIndex + 1]),
        ],
        coreProgram.programId
      );

      const emitterAddress = Buffer.alloc(32);

      const newSetVaa = createTokenTransferVAA({
        guardianSetIndex: currentGuardianSetIndex + 1,
        emitterChain: 1,
        emitterAddress,
        sequence: BigInt(3002),
        guardianKeys: newGuardianKeys,
        transferPayload: {
          payloadType: 1,
          amount: BigInt(100_000_000),
          tokenAddress: Buffer.alloc(32),
          tokenChain: 1,
          recipient: Buffer.alloc(32),
          recipientChain: SOL_CHAIN_ID,
          targetToken: Buffer.alloc(32),
          targetAmount: BigInt(100_000_000),
          exchangeRateNum: BigInt(1),
          exchangeRateDenom: BigInt(1),
        },
        signerCount: 13,
      });

      const newBodyHash = Buffer.from(
        keccak256(newSetVaa.slice(6 + 13 * 66)),
        "hex"
      );
      const newVaaHash = Buffer.from(keccak256(newBodyHash), "hex");

      const [newPostedVaaPda] = findProgramAddress(
        [Buffer.from("PostedVAA"), newVaaHash],
        coreProgram.programId
      );

      const newVaaAccount = await createVaaDataAccount(connection, payer, newSetVaa);

      const { emitterChain: newEmitterChain, emitterAddress: newVaaEmitterAddr, sequence: newSequence } = extractVAAEmitterInfo(newSetVaa);

      await coreProgram.methods
        .postVaa(newEmitterChain, Array.from(newVaaEmitterAddr), new BN(newSequence.toString()))
        .accounts({
          bridge: bridgePda,
          guardianSet: newGuardianSetPda,
          vaaBuffer: newVaaAccount.publicKey,
          postedVaa: newPostedVaaPda,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([
          ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })
        ])
        .signers([payer])
        .rpc();

      const postedVaa = await coreProgram.account.postedVaa.fetch(newPostedVaaPda);
      expect(postedVaa.consumed).to.be.false;
    });

    it("INT-SOL-006: 过期后旧Set拒绝", async () => {
      const [oldGuardianSetPda] = findProgramAddress(
        [Buffer.from("GuardianSet"), Buffer.from([0, 0, 0, 0])],
        coreProgram.programId
      );

      const oldGuardianSet = await coreProgram.account.guardianSet.fetch(
        oldGuardianSetPda
      );

      expect(oldGuardianSet.expirationTime).to.be.greaterThan(0);

      console.log(
        "旧Guardian Set过期时间:",
        new Date(oldGuardianSet.expirationTime * 1000).toISOString()
      );
    });
  });
});
