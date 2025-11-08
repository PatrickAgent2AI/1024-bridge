/**
 * 演示测试：展示真实的密码学实现
 * 
 * 运行：ts-mocha -p ./tsconfig.json tests/demo-crypto.test.ts
 */

import { expect } from "chai";
import {
  generateGuardianKeys,
  generateGuardianKey,
  signVAA,
  verifyVAASignature,
  createTokenTransferVAA,
  parseVAABodyHash,
  TokenTransferPayload,
} from "./utils/vaa";
import { keccak256 } from "js-sha3";

describe("密码学实现演示", () => {
  it("演示1: Guardian密钥生成（secp256k1）", () => {
    console.log("\n" + "=".repeat(60));
    console.log("演示1: 生成19个Guardian密钥");
    console.log("=".repeat(60));
    
    const guardianKeys = generateGuardianKeys(19);
    
    console.log(`\n生成了 ${guardianKeys.length} 个Guardian密钥`);
    console.log("\n前3个Guardian:");
    for (let i = 0; i < 3; i++) {
      console.log(`\nGuardian ${i}:`);
      console.log(`  私钥: 0x${guardianKeys[i].privateKey.slice(0, 8).toString('hex')}... (32 bytes)`);
      console.log(`  公钥: 0x${guardianKeys[i].publicKey.slice(0, 16).toString('hex')}... (64 bytes)`);
      console.log(`  地址: 0x${guardianKeys[i].address.toString('hex')} (20 bytes)`);
    }
    
    expect(guardianKeys).to.have.lengthOf(19);
    expect(guardianKeys[0].privateKey).to.have.lengthOf(32);
    expect(guardianKeys[0].publicKey).to.have.lengthOf(64);
    expect(guardianKeys[0].address).to.have.lengthOf(20);
  });
  
  it("演示2: 签名和验证", () => {
    console.log("\n" + "=".repeat(60));
    console.log("演示2: ECDSA签名和验证");
    console.log("=".repeat(60));
    
    // 生成一个Guardian密钥
    const guardianKey = generateGuardianKey();
    console.log(`\nGuardian地址: 0x${guardianKey.address.toString('hex')}`);
    
    // 创建测试消息
    const message = Buffer.from("Hello Wormhole Bridge!");
    const messageHash = Buffer.from(keccak256(message), 'hex');
    console.log(`\n消息: "${message.toString()}"`);
    console.log(`消息哈希: 0x${messageHash.toString('hex')}`);
    
    // 签名
    const signature = signVAA(messageHash, guardianKey, 0);
    console.log(`\n签名结果:`);
    console.log(`  r: 0x${signature.r.toString('hex')}`);
    console.log(`  s: 0x${signature.s.toString('hex')}`);
    console.log(`  v: ${signature.v}`);
    
    // 验证
    const isValid = verifyVAASignature(messageHash, signature, guardianKey.address);
    console.log(`\n签名验证: ${isValid ? '✓ 通过' : '✗ 失败'}`);
    
    expect(isValid).to.be.true;
  });
  
  it("演示3: 完整VAA构造", () => {
    console.log("\n" + "=".repeat(60));
    console.log("演示3: 构造TokenTransfer VAA");
    console.log("=".repeat(60));
    
    // 生成19个Guardian密钥
    const guardianKeys = generateGuardianKeys(19);
    console.log(`\n使用 ${guardianKeys.length} 个Guardian密钥`);
    
    // 构造TokenTransfer payload
    const payload: TokenTransferPayload = {
      payloadType: 1,
      amount: BigInt("1000000000"),  // 1000 USDC
      tokenAddress: Buffer.alloc(32),
      tokenChain: 1,  // Ethereum
      recipient: Buffer.alloc(32),
      recipientChain: 2,  // Solana
    };
    
    console.log(`\nPayload内容:`);
    console.log(`  类型: TokenTransfer (1)`);
    console.log(`  金额: ${payload.amount.toString()} (1000 USDC)`);
    console.log(`  源链: Ethereum (1)`);
    console.log(`  目标链: Solana (2)`);
    
    // 创建VAA（13个Guardian签名）
    console.log(`\n使用前13个Guardian签名...`);
    const vaa = createTokenTransferVAA({
      guardianSetIndex: 0,
      emitterChain: 1,
      emitterAddress: Buffer.alloc(32),
      sequence: BigInt(42),
      guardianKeys: guardianKeys,
      transferPayload: payload,
      signerCount: 13,
    });
    
    console.log(`\nVAA构造完成:`);
    console.log(`  大小: ${vaa.length} bytes`);
    console.log(`  版本: ${vaa.readUInt8(0)}`);
    console.log(`  Guardian Set索引: ${vaa.readUInt32BE(1)}`);
    console.log(`  签名数量: ${vaa.readUInt8(5)}`);
    
    // 验证签名
    const bodyHash = parseVAABodyHash(vaa);
    console.log(`\nBody Hash: 0x${bodyHash.slice(0, 16).toString('hex')}...`);
    
    let validSignatures = 0;
    for (let i = 0; i < 13; i++) {
      const offset = 6 + i * 66;
      const sig = {
        guardianIndex: i,
        r: vaa.slice(offset + 1, offset + 33),
        s: vaa.slice(offset + 33, offset + 65),
        v: vaa.readUInt8(offset + 65),
      };
      
      if (verifyVAASignature(bodyHash, sig, guardianKeys[i].address)) {
        validSignatures++;
      }
    }
    
    console.log(`\n签名验证结果: ${validSignatures}/13 ✓`);
    console.log(`达到门限: ${validSignatures >= 13 ? 'YES ✓' : 'NO ✗'}`);
    
    expect(vaa).to.have.lengthOf.greaterThan(0);
    expect(validSignatures).to.equal(13);
  });
  
  it("演示4: Guardian Set升级", () => {
    console.log("\n" + "=".repeat(60));
    console.log("演示4: Guardian Set升级流程");
    console.log("=".repeat(60));
    
    // 旧Guardian Set
    const oldGuardians = generateGuardianKeys(19);
    console.log(`\n旧Guardian Set (索引0):`);
    console.log(`  Guardian 0: 0x${oldGuardians[0].address.toString('hex')}`);
    console.log(`  Guardian 18: 0x${oldGuardians[18].address.toString('hex')}`);
    
    // 新Guardian Set
    const seed = Buffer.alloc(32);
    seed.writeUInt32BE(100, 28);
    const newGuardians = [generateGuardianKey(seed)];
    for (let i = 1; i < 19; i++) {
      const s = Buffer.alloc(32);
      s.writeUInt32BE(100 + i, 28);
      newGuardians.push(generateGuardianKey(s));
    }
    
    console.log(`\n新Guardian Set (索引1):`);
    console.log(`  Guardian 0: 0x${newGuardians[0].address.toString('hex')}`);
    console.log(`  Guardian 18: 0x${newGuardians[18].address.toString('hex')}`);
    
    console.log(`\n验证新旧Guardian不同:`);
    console.log(`  Guardian 0 相同? ${oldGuardians[0].address.equals(newGuardians[0].address) ? 'NO ✗' : 'YES ✓'}`);
    
    console.log(`\n升级流程:`);
    console.log(`  1. 使用旧Guardian Set (索引0) 签名升级VAA`);
    console.log(`  2. 升级VAA包含新Guardian Set (索引1) 的地址`);
    console.log(`  3. 新旧Set有7天过渡期`);
    console.log(`  4. 过渡期后旧Set失效`);
    
    expect(oldGuardians[0].address.equals(newGuardians[0].address)).to.be.false;
  });
});

