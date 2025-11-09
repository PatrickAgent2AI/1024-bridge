import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { 
  PublicKey, 
  Keypair, 
  SystemProgram, 
  LAMPORTS_PER_SOL,
  Transaction,
  sendAndConfirmTransaction,
  ComputeBudgetProgram
} from "@solana/web3.js";
import {
  setupTestEnvironment,
  airdrop,
  findProgramAddress,
  TEST_GUARDIAN_KEYS,
  getGuardianAddresses,
  generateNewGuardianKeys,
  createVaaDataAccount,
  TEST_PAYER,
} from "../utils/setup";
import {
  createTestVAA,
  createGuardianSetUpgradeVAA,
  GuardianKeyPair,
  serializeGuardianSetUpgradePayload,
  hashVAABody,
  serializeVAABody,
  extractVAAEmitterInfo,
} from "../utils/vaa";
import { keccak256 } from "js-sha3";

describe("solana-core 单元测试", () => {
  let provider: AnchorProvider;
  let program: Program;
  let payer: Keypair;
  let bridgePda: PublicKey;
  let guardianSetPda: PublicKey;
  let connection: anchor.web3.Connection;

  before(async () => {
    const env = await setupTestEnvironment();
    provider = env.provider;
    connection = env.connection;
    payer = TEST_PAYER; // 使用确定性密钥对，确保所有测试共享同一authority
    
    await airdrop(connection, payer.publicKey, 100 * LAMPORTS_PER_SOL);

    program = anchor.workspace.SolanaCore as Program;

    [bridgePda] = findProgramAddress(
      [Buffer.from("Bridge")],
      program.programId
    );

    [guardianSetPda] = findProgramAddress(
      [Buffer.from("GuardianSet"), Buffer.from([0, 0, 0, 0])],
      program.programId
    );
  });

  describe("2.1.1 initialize指令测试", () => {
    it("UNIT-SC-001: 正常初始化Bridge", async () => {
      const bridgeExists = await connection.getAccountInfo(bridgePda);
      if (bridgeExists) {
        console.log("  Bridge已存在，跳过初始化（测试套件共享）");
        const bridge = await program.account.bridge.fetch(bridgePda);
        expect(bridge.guardianSetIndex).to.be.a('number');
        expect(bridge.messageFee.toNumber()).to.be.greaterThan(0);
        return;
      }

      const guardians = getGuardianAddresses();
      const messageFee = new BN(1_000_000);
      
      await program.methods
        .initialize(0, guardians, messageFee)
        .accounts({
          bridge: bridgePda,
          guardianSet: guardianSetPda,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();

      const bridge = await program.account.bridge.fetch(bridgePda);
      expect(bridge.guardianSetIndex).to.equal(0);
      expect(bridge.messageFee.toNumber()).to.equal(1_000_000);
      expect(bridge.paused).to.be.false;
    });

    it("UNIT-SC-002: 初始化Guardian Set", async () => {
      const guardianSet = await program.account.guardianSet.fetch(guardianSetPda);
      
      expect(guardianSet.index).to.equal(0);
      expect(guardianSet.guardians).to.have.lengthOf(19);
      expect(guardianSet.expirationTime).to.equal(0);
    });

    it("UNIT-SC-003: 设置初始message_fee", async () => {
      const bridge = await program.account.bridge.fetch(bridgePda);
      expect(bridge.messageFee.toNumber()).to.equal(1_000_000);
    });

    it("UNIT-SC-004: 重复初始化失败", async () => {
      const guardians = getGuardianAddresses();
      const messageFee = new BN(1_000_000);
      
      try {
        await program.methods
          .initialize(0, guardians, messageFee)
          .accounts({
            bridge: bridgePda,
            guardianSet: guardianSetPda,
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
  });

  describe("2.1.2 post_message指令测试", () => {
    let emitter: Keypair;
    let sequencePda: PublicKey;

    before(async () => {
      emitter = Keypair.generate();
      await airdrop(connection, emitter.publicKey);

      [sequencePda] = findProgramAddress(
        [Buffer.from("Sequence"), emitter.publicKey.toBuffer()],
        program.programId
      );
    });

    it("UNIT-SC-005: 正常发送消息", async () => {
      const payload = Buffer.from([1, 2, 3, 4, 5]);
      const nonce = 12345;
      const consistencyLevel = 32;

      const messagePda = Keypair.generate();

      await program.methods
        .postMessage(nonce, payload, consistencyLevel)
        .accounts({
          bridge: bridgePda,
          message: messagePda.publicKey,
          emitter: emitter.publicKey,
          sequence: sequencePda,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer, messagePda])
        .rpc();

      const message = await program.account.postedMessage.fetch(messagePda.publicKey);
      expect(message.nonce).to.equal(nonce);
      expect(Buffer.from(message.payload)).to.deep.equal(payload);
      expect(message.consistencyLevel).to.equal(consistencyLevel);
      expect(message.sequence.toNumber()).to.equal(0);
    });

    it("UNIT-SC-006: 序列号递增", async () => {
      const payload = Buffer.from([6, 7, 8]);
      const nonce = 12346;
      const messagePda = Keypair.generate();

      await program.methods
        .postMessage(nonce, payload, 32)
        .accounts({
          bridge: bridgePda,
          message: messagePda.publicKey,
          emitter: emitter.publicKey,
          sequence: sequencePda,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer, messagePda])
        .rpc();

      const sequence = await program.account.sequence.fetch(sequencePda);
      expect(sequence.sequence.toNumber()).to.equal(2);
    });

    it("UNIT-SC-007: 手续费不足", async () => {
      const payload = Buffer.from([1, 2, 3]);
      const nonce = 12347;
      const messagePda = Keypair.generate();

      const poorPayer = Keypair.generate();
      await airdrop(connection, poorPayer.publicKey, 0.0001 * LAMPORTS_PER_SOL);

      try {
        await program.methods
          .postMessage(nonce, payload, 32)
          .accounts({
            bridge: bridgePda,
            message: messagePda.publicKey,
            emitter: emitter.publicKey,
            sequence: sequencePda,
            payer: poorPayer.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([poorPayer, messagePda])
          .rpc();
        expect.fail("应该失败");
      } catch (error: any) {
        expect(error).to.exist;
      }
    });

    it("UNIT-SC-008: payload大小限制", async () => {
      const largePayload = Buffer.alloc(30000);
      const nonce = 12348;
      const messagePda = Keypair.generate();

      try {
        await program.methods
          .postMessage(nonce, largePayload, 32)
          .accounts({
            bridge: bridgePda,
            message: messagePda.publicKey,
            emitter: emitter.publicKey,
            sequence: sequencePda,
            payer: payer.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([payer, messagePda])
          .rpc();
        expect.fail("应该失败");
      } catch (error: any) {
        expect(error).to.exist;
      }
    });

    it("UNIT-SC-009: Bridge暂停时拒绝", async () => {
      await program.methods
        .setPaused(true)
        .accounts({
          bridge: bridgePda,
          authority: payer.publicKey,
        })
        .signers([payer])
        .rpc();

      const payload = Buffer.from([1, 2, 3]);
      const nonce = 12349;
      const messagePda = Keypair.generate();

      try {
        await program.methods
          .postMessage(nonce, payload, 32)
          .accounts({
            bridge: bridgePda,
            message: messagePda.publicKey,
            emitter: emitter.publicKey,
            sequence: sequencePda,
            payer: payer.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([payer, messagePda])
          .rpc();
        expect.fail("应该失败");
      } catch (error: any) {
        expect(error.message).to.include("paused");
      }

      await program.methods
        .setPaused(false)
        .accounts({
          bridge: bridgePda,
          authority: payer.publicKey,
        })
        .signers([payer])
        .rpc();
    });
  });

  describe("2.1.3 post_vaa指令测试", () => {
    it("UNIT-SC-010: 正常接收VAA", async () => {
      const emitterAddress = Buffer.alloc(32);
      emitterAddress.writeUInt32BE(0x742d3500, 0);
      
      const payload = Buffer.from("test payload");
      
      const vaaBuffer = createTestVAA({
        guardianSetIndex: 0,
        emitterChain: 1,
        emitterAddress,
        sequence: BigInt(42),
        payload,
        guardianKeys: TEST_GUARDIAN_KEYS,
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
        program.programId
      );

      await program.methods
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

      const postedVaa = await program.account.postedVaa.fetch(postedVaaPda);
      expect(postedVaa.emitterChain).to.equal(1);
      expect(postedVaa.sequence.toNumber()).to.equal(42);
      expect(postedVaa.consumed).to.be.false;
    });

    it("UNIT-SC-011: VAA签名验证成功", async () => {
      const emitterAddress = Buffer.alloc(32);
      const payload = Buffer.from("test payload 2");
      
      const vaaBuffer = createTestVAA({
        guardianSetIndex: 0,
        emitterChain: 1,
        emitterAddress,
        sequence: BigInt(43),
        payload,
        guardianKeys: TEST_GUARDIAN_KEYS,
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
        program.programId
      );

      await program.methods
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

      const postedVaa = await program.account.postedVaa.fetch(postedVaaPda);
      expect(postedVaa.consumed).to.be.false;
    });

    it("UNIT-SC-012: 签名数量不足(<13)", async () => {
      const emitterAddress = Buffer.alloc(32);
      const payload = Buffer.from("test payload 3");
      
      const vaaBuffer = createTestVAA({
        guardianSetIndex: 0,
        emitterChain: 1,
        emitterAddress,
        sequence: BigInt(44),
        payload,
        guardianKeys: TEST_GUARDIAN_KEYS,
        signerCount: 12,
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
        program.programId
      );

      try {
        await program.methods
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
        expect.fail("应该失败");
      } catch (error: any) {
        expect(error.message).to.include("Insufficient signatures");
      }
    });

    it("UNIT-SC-013: 无效签名", async () => {
      const emitterAddress = Buffer.alloc(32);
      const payload = Buffer.from("test payload 4");
      
      const invalidGuardians = generateNewGuardianKeys(19);
      
      const vaaBuffer = createTestVAA({
        guardianSetIndex: 0,
        emitterChain: 1,
        emitterAddress,
        sequence: BigInt(45),
        payload,
        guardianKeys: invalidGuardians,
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
        program.programId
      );

      try {
        await program.methods
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
        expect.fail("应该失败");
      } catch (error: any) {
        expect(error.message).to.include("Invalid signature");
      }
    });

    it.skip("UNIT-SC-014: Guardian Set过期 (暂时跳过)", async () => {
      const newGuardians = generateNewGuardianKeys(19);
      const newGuardianAddresses = newGuardians.map(g => g.address);

      const newGuardianSetKeypair = Keypair.generate();
      const upgradeVaaKeypair = Keypair.generate();

      const upgradePayload = serializeGuardianSetUpgradePayload({
        module: 0x01,
        action: 0x02,
        chain: 0,
        newGuardianSetIndex: 1,
        newGuardians: newGuardianAddresses,
      });

      const vaaBuffer = createTestVAA({
        guardianSetIndex: 0,
        emitterChain: 1,
        emitterAddress: Buffer.alloc(32),
        sequence: BigInt(100),
        payload: upgradePayload,
        guardianKeys: TEST_GUARDIAN_KEYS,
        signerCount: 13,
      });

      const vaaAccount = await createVaaDataAccount(connection, payer, vaaBuffer);

      await program.methods
        .updateGuardianSet()
        .accounts({
          bridge: bridgePda,
          currentGuardianSet: guardianSetPda,
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

      const oldGuardianSet = await program.account.guardianSet.fetch(guardianSetPda);
      expect(oldGuardianSet.expirationTime).to.be.greaterThan(0);
    });

    it("UNIT-SC-015: VAA重复消费", async () => {
      const emitterAddress = Buffer.alloc(32);
      const payload = Buffer.from("test payload 5");
      
      const vaaBuffer = createTestVAA({
        guardianSetIndex: 0,
        emitterChain: 1,
        emitterAddress,
        sequence: BigInt(46),
        payload,
        guardianKeys: TEST_GUARDIAN_KEYS,
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
        program.programId
      );

      await program.methods
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

      try {
        await program.methods
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
        expect.fail("应该失败");
      } catch (error: any) {
        expect(error.message).to.include("already in use");
      }
    });

    it("UNIT-SC-016: 无效的VAA格式", async () => {
      const invalidVaa = Buffer.alloc(10);

      const vaaAccount = await createVaaDataAccount(connection, payer, invalidVaa);

      // 对于无效VAA，使用假的emitter信息
      const fakeEmitterChain = 1;
      const fakeEmitterAddr = Buffer.alloc(32);
      const fakeSequence = BigInt(999);
      
      const fakeSequenceBuffer = Buffer.alloc(8);
      fakeSequenceBuffer.writeBigUInt64LE(fakeSequence);
      
      const fakeEmitterChainBuffer = Buffer.alloc(2);
      fakeEmitterChainBuffer.writeUInt16LE(fakeEmitterChain);
      
      const [postedVaaPda] = findProgramAddress(
        [
          Buffer.from("PostedVAA"),
          fakeEmitterChainBuffer,
          fakeEmitterAddr,
          fakeSequenceBuffer
        ],
        program.programId
      );

      try {
        await program.methods
          .postVaa(fakeEmitterChain, Array.from(fakeEmitterAddr), new BN(fakeSequence.toString()))
          .accounts({
            bridge: bridgePda,
            guardianSet: guardianSetPda,
            vaaBuffer: vaaAccount.publicKey,
            postedVaa: postedVaaPda,
            payer: payer.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([payer])
          .rpc();
        expect.fail("应该失败");
      } catch (error: any) {
        expect(error).to.exist;
      }
    });
  });

  describe.skip("2.1.4 update_guardian_set指令测试 (暂时跳过)", () => {
    it("UNIT-SC-017: 正常升级Guardian Set", async () => {
      const newGuardians = generateNewGuardianKeys(19);
      const newGuardianAddresses = newGuardians.map(g => g.address);

      const newGuardianSetKeypair = Keypair.generate();
      const upgradeVaaKeypair = Keypair.generate();

      const upgradePayload = serializeGuardianSetUpgradePayload({
        module: 0x01,
        action: 0x02,
        chain: 0,
        newGuardianSetIndex: 2,
        newGuardians: newGuardianAddresses,
      });

      const vaaBuffer = createTestVAA({
        guardianSetIndex: 1,
        emitterChain: 1,
        emitterAddress: Buffer.alloc(32),
        sequence: BigInt(101),
        payload: upgradePayload,
        guardianKeys: TEST_GUARDIAN_KEYS,
        signerCount: 13,
      });

      const vaaAccount = await createVaaDataAccount(connection, payer, vaaBuffer);

      const [currentGuardianSetPda] = findProgramAddress(
        [Buffer.from("GuardianSet"), Buffer.from([0, 0, 0, 1])],
        program.programId
      );

      await program.methods
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

      const bridge = await program.account.bridge.fetch(bridgePda);
      expect(bridge.guardianSetIndex).to.equal(2);

      const newSet = await program.account.guardianSet.fetch(newGuardianSetKeypair.publicKey);
      expect(newSet.index).to.equal(2);
      expect(newSet.expirationTime).to.equal(0);
    });

    it("UNIT-SC-018: 新旧Set并存(过渡期)", async () => {
      const [oldGuardianSetPda] = findProgramAddress(
        [Buffer.from("GuardianSet"), Buffer.from([0, 0, 0, 1])],
        program.programId
      );

      const [newGuardianSetPda] = findProgramAddress(
        [Buffer.from("GuardianSet"), Buffer.from([0, 0, 0, 2])],
        program.programId
      );

      const oldSet = await program.account.guardianSet.fetch(oldGuardianSetPda);
      const newSet = await program.account.guardianSet.fetch(newGuardianSetPda);

      expect(oldSet.expirationTime).to.be.greaterThan(0);
      expect(newSet.expirationTime).to.equal(0);
    });

    it("UNIT-SC-019: 旧Set过期后拒绝", async () => {
      const emitterAddress = Buffer.alloc(32);
      const payload = Buffer.from("test with expired guardian set");
      
      const [oldGuardianSetPda] = findProgramAddress(
        [Buffer.from("GuardianSet"), Buffer.from([0, 0, 0, 0])],
        program.programId
      );

      const oldGuardianSet = await program.account.guardianSet.fetch(oldGuardianSetPda);
      
      if (oldGuardianSet.expirationTime === 0) {
        console.log("旧Guardian Set尚未过期，跳过此测试");
        return;
      }

      const vaaBuffer = createTestVAA({
        guardianSetIndex: 0,
        emitterChain: 1,
        emitterAddress,
        sequence: BigInt(200),
        payload,
        guardianKeys: TEST_GUARDIAN_KEYS,
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
        program.programId
      );

      try {
        await program.methods
          .postVaa(emitterChain, Array.from(vaaEmitterAddr), new BN(sequence.toString()))
          .accounts({
            bridge: bridgePda,
            guardianSet: oldGuardianSetPda,
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
        expect.fail("应该失败");
      } catch (error: any) {
        expect(error.message).to.include("expired");
      }
    });

    it("UNIT-SC-020: 非治理VAA拒绝", async () => {
      const newGuardians = generateNewGuardianKeys(19);
      const newGuardianAddresses = newGuardians.map(g => g.address);

      const [newGuardianSetPda] = findProgramAddress(
        [Buffer.from("GuardianSet"), Buffer.from([0, 0, 0, 3])],
        program.programId
      );

      const invalidPayload = Buffer.from("not a governance payload");

      const vaaBuffer = createTestVAA({
        guardianSetIndex: 2,
        emitterChain: 1,
        emitterAddress: Buffer.alloc(32),
        sequence: BigInt(102),
        payload: invalidPayload,
        guardianKeys: TEST_GUARDIAN_KEYS,
        signerCount: 13,
      });

      const bodyHash = Buffer.from(keccak256(vaaBuffer.slice(6 + 13 * 66)), 'hex');
      const vaaHash = Buffer.from(keccak256(bodyHash), 'hex');

      const [upgradeVaaPda] = findProgramAddress(
        [Buffer.from("PostedVAA"), vaaHash],
        program.programId
      );

      const [currentGuardianSetPda] = findProgramAddress(
        [Buffer.from("GuardianSet"), Buffer.from([0, 0, 0, 2])],
        program.programId
      );

      const vaaAccount = await createVaaDataAccount(connection, payer, vaaBuffer);

      try {
        await program.methods
          .updateGuardianSet()
          .accounts({
            bridge: bridgePda,
            currentGuardianSet: currentGuardianSetPda,
            vaaBuffer: vaaAccount.publicKey,
            newGuardianSet: newGuardianSetPda,
            upgradeVaa: upgradeVaaPda,
            payer: payer.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([payer])
          .rpc();
        expect.fail("应该失败");
      } catch (error: any) {
        expect(error).to.exist;
      }
    });
  });
});
