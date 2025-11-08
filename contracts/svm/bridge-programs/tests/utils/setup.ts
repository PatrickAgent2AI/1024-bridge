/**
 * 测试环境设置工具
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, createAccount, mintTo, getAccount } from "@solana/spl-token";

/**
 * 导入Guardian密钥类型
 */
import { GuardianKeyPair, generateGuardianKeys } from "./vaa";

/**
 * 测试Guardian密钥（19个secp256k1密钥对）
 */
export const TEST_GUARDIAN_KEYS: GuardianKeyPair[] = generateGuardianKeys(19);

/**
 * 获取Guardian地址列表（用于initialize）
 */
export function getGuardianAddresses(): Buffer[] {
  return TEST_GUARDIAN_KEYS.map(key => key.address);
}

/**
 * 初始化测试环境
 */
export async function setupTestEnvironment() {
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);
  
  return {
    provider,
    connection: provider.connection,
    wallet: provider.wallet as anchor.Wallet,
  };
}

/**
 * 空投SOL到账户
 */
export async function airdrop(
  connection: anchor.web3.Connection,
  publicKey: PublicKey,
  amount: number = 10 * LAMPORTS_PER_SOL
): Promise<void> {
  const signature = await connection.requestAirdrop(publicKey, amount);
  const latestBlockhash = await connection.getLatestBlockhash();
  await connection.confirmTransaction({
    signature,
    ...latestBlockhash,
  });
}

/**
 * 生成额外的测试Guardian密钥（用于升级测试）
 */
export function generateNewGuardianKeys(count: number = 19): GuardianKeyPair[] {
  const keys: GuardianKeyPair[] = [];
  for (let i = 0; i < count; i++) {
    // 使用不同的种子生成新的Guardian Set
    const seed = Buffer.alloc(32);
    seed.writeUInt32BE(i + 100, 0); // 偏移100避免与原Guardian重复
    seed.writeUInt32BE(0xABCDEF00, 4); // 不同的magic number
    seed.writeUInt32BE(i * 0x2000 + 0xFFFF, 8);
    const { generateGuardianKey } = require("./vaa");
    keys.push(generateGuardianKey(seed));
  }
  return keys;
}

/**
 * 创建测试SPL Token Mint
 */
export async function createTestMint(
  connection: anchor.web3.Connection,
  payer: Keypair,
  decimals: number = 6
): Promise<PublicKey> {
  return await createMint(
    connection,
    payer,
    payer.publicKey,
    null,
    decimals,
    undefined,
    undefined,
    TOKEN_PROGRAM_ID
  );
}

/**
 * 创建测试Token账户并铸造代币
 */
export async function createAndMintTestToken(
  connection: anchor.web3.Connection,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey,
  amount: bigint
): Promise<PublicKey> {
  const tokenAccount = await createAccount(
    connection,
    payer,
    mint,
    owner,
    undefined,
    undefined,
    TOKEN_PROGRAM_ID
  );
  
  await mintTo(
    connection,
    payer,
    mint,
    tokenAccount,
    payer,
    amount,
    [],
    undefined,
    TOKEN_PROGRAM_ID
  );
  
  return tokenAccount;
}

/**
 * 获取Token账户余额
 */
export async function getTokenBalance(
  connection: anchor.web3.Connection,
  tokenAccount: PublicKey
): Promise<bigint> {
  const account = await getAccount(connection, tokenAccount, undefined, TOKEN_PROGRAM_ID);
  return account.amount;
}

/**
 * 推导PDA地址
 */
export function findProgramAddress(
  seeds: (Buffer | Uint8Array)[],
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(seeds, programId);
}

/**
 * 等待交易确认
 */
export async function confirmTransaction(
  connection: anchor.web3.Connection,
  signature: string
): Promise<void> {
  const latestBlockhash = await connection.getLatestBlockhash();
  await connection.confirmTransaction({
    signature,
    ...latestBlockhash,
  });
}

/**
 * 测试用户账户
 */
export const TEST_USERS = {
  alice: Keypair.generate(),
  bob: Keypair.generate(),
  charlie: Keypair.generate(),
};

/**
 * 以太坊地址转32字节格式
 */
export function ethAddressToBytes32(ethAddress: string): Buffer {
  const buffer = Buffer.alloc(32);
  const addressBuffer = Buffer.from(ethAddress.replace('0x', ''), 'hex');
  addressBuffer.copy(buffer, 12); // 以太坊地址20字节，前面补12个0
  return buffer;
}

/**
 * Solana公钥转32字节格式
 */
export function solanaAddressToBytes32(pubkey: PublicKey): Buffer {
  return Buffer.from(pubkey.toBytes());
}

