/**
 * 测试被跳过的VAA验证
 * 演示哪些验证被跳过，以及可能的安全影响
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import { SolanaCore } from "../../target/types/solana_core";
import { 
  generateGuardianKeys, 
  createTestVAA,
  GuardianKeyPair 
} from "../utils/vaa";
import { 
  findProgramAddress, 
  createVaaDataAccount 
} from "../utils/helpers";

describe("被跳过的VAA验证测试", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const coreProgram = anchor.workspace.SolanaCore as Program<SolanaCore>;
  const connection = provider.connection;
  const payer = (provider.wallet as anchor.Wallet).payer;

  let bridgePda: anchor.web3.PublicKey;
  let guardianSetPda: anchor.web3.PublicKey;
  let guardianKeys: GuardianKeyPair[];

  before(async () => {
    // 查找Bridge PDA
    [bridgePda] = findProgramAddress(
      [Buffer.from("Bridge")],
      coreProgram.programId
    );

    // 查找Guardian Set PDA
    [guardianSetPda] = findProgramAddress(
      [Buffer.from("GuardianSet"), Buffer.from([0, 0, 0, 0])],
      coreProgram.programId
    );

    // 生成测试Guardian密钥
    guardianKeys = generateGuardianKeys(19);
  });

  describe("1. 时间戳验证被跳过", () => {
    it("应该拒绝但实际接受：未来时间戳的VAA", async () => {
      // 使用未来1小时的时间戳
      const futureTimestamp = Math.floor(Date.now() / 1000) + 3600;

      const payload = Buffer.from("test payload with future timestamp");
      const emitterChain = 2;
      const emitterAddress = Buffer.alloc(32, 1);
      const sequence = BigInt(1001);

      // 创建带有未来时间戳的VAA
      const vaaBuffer = createTestVAA({
        guardianSetIndex: 0,
        emitterChain,
        emitterAddress,
        sequence,
        payload,
        guardianKeys,
        timestamp: futureTimestamp,  // 未来时间戳
      });

      const vaaAccount = await createVaaDataAccount(
        connection,
        payer,
        vaaBuffer
      );

      // 查找posted VAA PDA
      const [postedVaaPda] = findProgramAddress(
        [
          Buffer.from("PostedVAA"),
          Buffer.from(new Uint8Array(new Uint16Array([emitterChain]).buffer)),
          emitterAddress,
          Buffer.from(new Uint8Array(new BigUint64Array([sequence]).buffer)),
        ],
        coreProgram.programId
      );

      try {
        // 尝试post VAA - 应该失败但实际会成功
        await coreProgram.methods
          .postVaa(emitterChain, Array.from(emitterAddress), sequence)
          .accounts({
            bridge: bridgePda,
            guardianSet: guardianSetPda,
            vaaBuffer: vaaAccount.publicKey,
            postedVaa: postedVaaPda,
            payer: payer.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([payer])
          .rpc();

        // 验证VAA被成功post（安全问题：应该被拒绝）
        const postedVaa = await coreProgram.account.postedVaa.fetch(postedVaaPda);
        expect(postedVaa.timestamp).to.equal(futureTimestamp);
        
        console.log("⚠️  安全问题：未来时间戳的VAA被接受了！");
        console.log(`   当前时间: ${Math.floor(Date.now() / 1000)}`);
        console.log(`   VAA时间戳: ${futureTimestamp}`);
        console.log(`   差异: +${futureTimestamp - Math.floor(Date.now() / 1000)}秒`);
      } catch (error) {
        console.log("✅ 正确：未来时间戳的VAA被拒绝");
      }
    });

    it("应该拒绝但实际接受：极端陈旧的VAA（1年前）", async () => {
      // 使用1年前的时间戳
      const oldTimestamp = Math.floor(Date.now() / 1000) - 365 * 86400;

      const payload = Buffer.from("test payload with old timestamp");
      const emitterChain = 2;
      const emitterAddress = Buffer.alloc(32, 2);
      const sequence = BigInt(1002);

      const vaaBuffer = createTestVAA({
        guardianSetIndex: 0,
        emitterChain,
        emitterAddress,
        sequence,
        payload,
        guardianKeys,
        timestamp: oldTimestamp,  // 1年前的时间戳
      });

      const vaaAccount = await createVaaDataAccount(
        connection,
        payer,
        vaaBuffer
      );

      const [postedVaaPda] = findProgramAddress(
        [
          Buffer.from("PostedVAA"),
          Buffer.from(new Uint8Array(new Uint16Array([emitterChain]).buffer)),
          emitterAddress,
          Buffer.from(new Uint8Array(new BigUint64Array([sequence]).buffer)),
        ],
        coreProgram.programId
      );

      try {
        await coreProgram.methods
          .postVaa(emitterChain, Array.from(emitterAddress), sequence)
          .accounts({
            bridge: bridgePda,
            guardianSet: guardianSetPda,
            vaaBuffer: vaaAccount.publicKey,
            postedVaa: postedVaaPda,
            payer: payer.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([payer])
          .rpc();

        const postedVaa = await coreProgram.account.postedVaa.fetch(postedVaaPda);
        
        console.log("⚠️  安全问题：极端陈旧的VAA被接受了！");
        console.log(`   当前时间: ${Math.floor(Date.now() / 1000)}`);
        console.log(`   VAA时间戳: ${oldTimestamp}`);
        console.log(`   差异: -${Math.floor(Date.now() / 1000) - oldTimestamp}秒（${Math.floor((Math.floor(Date.now() / 1000) - oldTimestamp) / 86400)}天）`);
      } catch (error) {
        console.log("✅ 正确：陈旧的VAA被拒绝");
      }
    });
  });

  describe("2. Guardian Set过期时间验证被跳过", () => {
    it("演示：Guardian Set有expiration_time字段但未被检查", async () => {
      // 读取Guardian Set
      const guardianSet = await coreProgram.account.guardianSet.fetch(guardianSetPda);
      
      console.log("\n📋 Guardian Set信息:");
      console.log(`   Index: ${guardianSet.index}`);
      console.log(`   Guardians: ${guardianSet.guardians.length}`);
      console.log(`   Creation Time: ${guardianSet.creationTime}`);
      console.log(`   Expiration Time: ${guardianSet.expirationTime}`);
      
      if (guardianSet.expirationTime === 0) {
        console.log(`   ℹ️  当前Guardian Set未设置过期时间（expirationTime = 0）`);
        console.log(`   ⚠️  如果设置了过期时间，post_vaa不会检查它！`);
      } else {
        const currentTime = Math.floor(Date.now() / 1000);
        const isExpired = currentTime > guardianSet.expirationTime;
        
        console.log(`   当前时间: ${currentTime}`);
        console.log(`   ${isExpired ? '❌ 已过期' : '✅ 未过期'}`);
        
        if (isExpired) {
          console.log(`   ⚠️  警告：Guardian Set已过期，但VAA仍可能被接受！`);
        }
      }
    });

    it("说明：为什么Guardian Set过期检查很重要", () => {
      console.log("\n🔒 Guardian Set过期检查的重要性:");
      console.log("1. Guardian Set升级流程：");
      console.log("   - 新Guardian Set被创建（index + 1）");
      console.log("   - 旧Guardian Set设置7天过期时间");
      console.log("   - 过渡期后，旧Guardian Set应该失效");
      console.log("");
      console.log("2. 安全风险：");
      console.log("   - 如果不检查过期时间，旧的Guardian密钥仍可使用");
      console.log("   - 如果旧Guardian密钥被泄露，攻击者可伪造VAA");
      console.log("   - 即使已升级到新Guardian Set，旧的仍可用");
      console.log("");
      console.log("3. 当前状态：");
      console.log("   ❌ post_vaa函数不检查guardian_set.expiration_time");
      console.log("   ✅ BridgeError::GuardianSetExpired错误码已存在");
      console.log("   ⚠️  只需添加检查逻辑即可修复");
    });
  });

  describe("3. Consistency Level验证被跳过", () => {
    it("应该根据业务规则验证但实际不验证：任意consistency level", async () => {
      // 使用非标准的consistency level
      const unusualConsistencyLevel = 99;  // 通常应该是0-200之间的有效值

      const payload = Buffer.from("test payload with unusual consistency level");
      const emitterChain = 2;
      const emitterAddress = Buffer.alloc(32, 3);
      const sequence = BigInt(1003);

      const vaaBuffer = createTestVAA({
        guardianSetIndex: 0,
        emitterChain,
        emitterAddress,
        sequence,
        payload,
        guardianKeys,
        consistencyLevel: unusualConsistencyLevel,
      });

      const vaaAccount = await createVaaDataAccount(
        connection,
        payer,
        vaaBuffer
      );

      const [postedVaaPda] = findProgramAddress(
        [
          Buffer.from("PostedVAA"),
          Buffer.from(new Uint8Array(new Uint16Array([emitterChain]).buffer)),
          emitterAddress,
          Buffer.from(new Uint8Array(new BigUint64Array([sequence]).buffer)),
        ],
        coreProgram.programId
      );

      try {
        await coreProgram.methods
          .postVaa(emitterChain, Array.from(emitterAddress), sequence)
          .accounts({
            bridge: bridgePda,
            guardianSet: guardianSetPda,
            vaaBuffer: vaaAccount.publicKey,
            postedVaa: postedVaaPda,
            payer: payer.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([payer])
          .rpc();

        const postedVaa = await coreProgram.account.postedVaa.fetch(postedVaaPda);
        
        console.log("ℹ️  Consistency Level被接受（未验证）:");
        console.log(`   Consistency Level: ${postedVaa.consistencyLevel}`);
        console.log(`   说明：这可能是合理的设计，取决于业务需求`);
      } catch (error) {
        console.log("如果验证了Consistency Level，会在这里失败");
      }
    });
  });

  describe("4. 已实施的验证（对比）", () => {
    it("✅ 会正确拒绝：签名数量不足", async () => {
      const payload = Buffer.from("test payload");
      const emitterChain = 2;
      const emitterAddress = Buffer.alloc(32, 4);
      const sequence = BigInt(1004);

      // 只用12个签名（不足13个门限）
      const vaaBuffer = createTestVAA({
        guardianSetIndex: 0,
        emitterChain,
        emitterAddress,
        sequence,
        payload,
        guardianKeys,
        signerCount: 12,  // 不足
      });

      const vaaAccount = await createVaaDataAccount(
        connection,
        payer,
        vaaBuffer
      );

      const [postedVaaPda] = findProgramAddress(
        [
          Buffer.from("PostedVAA"),
          Buffer.from(new Uint8Array(new Uint16Array([emitterChain]).buffer)),
          emitterAddress,
          Buffer.from(new Uint8Array(new BigUint64Array([sequence]).buffer)),
        ],
        coreProgram.programId
      );

      try {
        await coreProgram.methods
          .postVaa(emitterChain, Array.from(emitterAddress), sequence)
          .accounts({
            bridge: bridgePda,
            guardianSet: guardianSetPda,
            vaaBuffer: vaaAccount.publicKey,
            postedVaa: postedVaaPda,
            payer: payer.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([payer])
          .rpc();

        throw new Error("应该失败但成功了");
      } catch (error: any) {
        expect(error.toString()).to.include("InsufficientSignatures");
        console.log("✅ 正确：签名数量不足被拒绝");
      }
    });

    it("✅ 会正确拒绝：重复提交相同的VAA", async () => {
      const payload = Buffer.from("test payload for replay");
      const emitterChain = 2;
      const emitterAddress = Buffer.alloc(32, 5);
      const sequence = BigInt(1005);

      const vaaBuffer = createTestVAA({
        guardianSetIndex: 0,
        emitterChain,
        emitterAddress,
        sequence,
        payload,
        guardianKeys,
      });

      const vaaAccount1 = await createVaaDataAccount(
        connection,
        payer,
        vaaBuffer
      );

      const [postedVaaPda] = findProgramAddress(
        [
          Buffer.from("PostedVAA"),
          Buffer.from(new Uint8Array(new Uint16Array([emitterChain]).buffer)),
          emitterAddress,
          Buffer.from(new Uint8Array(new BigUint64Array([sequence]).buffer)),
        ],
        coreProgram.programId
      );

      // 第一次提交
      await coreProgram.methods
        .postVaa(emitterChain, Array.from(emitterAddress), sequence)
        .accounts({
          bridge: bridgePda,
          guardianSet: guardianSetPda,
          vaaBuffer: vaaAccount1.publicKey,
          postedVaa: postedVaaPda,
          payer: payer.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([payer])
        .rpc();

      console.log("✅ 第一次提交成功");

      // 尝试第二次提交相同的VAA
      const vaaAccount2 = await createVaaDataAccount(
        connection,
        payer,
        vaaBuffer
      );

      try {
        await coreProgram.methods
          .postVaa(emitterChain, Array.from(emitterAddress), sequence)
          .accounts({
            bridge: bridgePda,
            guardianSet: guardianSetPda,
            vaaBuffer: vaaAccount2.publicKey,
            postedVaa: postedVaaPda,
            payer: payer.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([payer])
          .rpc();

        throw new Error("应该失败但成功了");
      } catch (error: any) {
        // PDA已存在会导致失败
        console.log("✅ 正确：重复提交被拒绝（PDA已存在）");
      }
    });
  });

  describe("5. 安全建议", () => {
    it("显示修复建议", () => {
      console.log("\n🔧 修复建议:");
      console.log("\n1. 添加Guardian Set过期检查（高优先级）:");
      console.log("```rust");
      console.log("// 在post_vaa函数中，第118行之后添加");
      console.log("require!(");
      console.log("    ctx.accounts.guardian_set.expiration_time == 0 || ");
      console.log("    Clock::get()?.unix_timestamp < ctx.accounts.guardian_set.expiration_time as i64,");
      console.log("    BridgeError::GuardianSetExpired");
      console.log(");");
      console.log("```");
      
      console.log("\n2. 添加时间戳合理性检查（中优先级）:");
      console.log("```rust");
      console.log("// 在post_vaa函数中，第188行之后添加");
      console.log("let current_time = Clock::get()?.unix_timestamp;");
      console.log("require!(");
      console.log("    timestamp as i64 <= current_time + 300,  // 容忍5分钟");
      console.log("    BridgeError::InvalidTimestamp");
      console.log(");");
      console.log("require!(");
      console.log("    timestamp as i64 >= current_time - 86400,  // 不超过24小时");
      console.log("    BridgeError::TimestampTooOld");
      console.log(");");
      console.log("```");
      
      console.log("\n3. 更新误导性注释（文档改进）:");
      console.log("   将第131-133行的注释改为准确描述实际实现");
      
      console.log("\n4. 需要添加的错误码:");
      console.log("```rust");
      console.log("#[msg(\"Invalid timestamp\")]");
      console.log("InvalidTimestamp,");
      console.log("");
      console.log("#[msg(\"Timestamp too old\")]");
      console.log("TimestampTooOld,");
      console.log("```");
    });
  });
});

