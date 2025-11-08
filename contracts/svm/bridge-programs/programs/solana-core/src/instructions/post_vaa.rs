use anchor_lang::prelude::*;
use anchor_lang::solana_program::{keccak, secp256k1_recover::secp256k1_recover};
use crate::state::*;
use crate::error::BridgeError;
use byteorder::{BigEndian, ReadBytesExt};
use std::io::Cursor;

#[derive(Accounts)]
pub struct PostVAA<'info> {
    #[account(mut, seeds = [b"Bridge"], bump)]
    pub bridge: Account<'info, Bridge>,
    
    #[account(
        seeds = [b"GuardianSet", bridge.guardian_set_index.to_le_bytes().as_ref()],
        bump
    )]
    pub guardian_set: Account<'info, GuardianSet>,
    
    #[account(
        init,
        payer = payer,
        space = PostedVAA::MAX_LEN
    )]
    pub posted_vaa: Account<'info, PostedVAA>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn post_vaa(
    ctx: Context<PostVAA>,
    vaa_data: Vec<u8>,
) -> Result<()> {
    let bridge = &ctx.accounts.bridge;
    let guardian_set = &ctx.accounts.guardian_set;
    
    // 检查Bridge是否暂停
    require!(!bridge.paused, BridgeError::BridgePaused);
    
    // 检查Guardian Set未过期
    let current_time = Clock::get()?.unix_timestamp as u32;
    require!(
        guardian_set.expiration_time == 0 || current_time < guardian_set.expiration_time,
        BridgeError::GuardianSetExpired
    );
    
    // 解析VAA
    let mut cursor = Cursor::new(&vaa_data);
    
    // 读取Header
    let version = cursor.read_u8().map_err(|_| BridgeError::InvalidVAA)?;
    require!(version == 1, BridgeError::InvalidVAA);
    
    let vaa_guardian_set_index = cursor.read_u32::<BigEndian>().map_err(|_| BridgeError::InvalidVAA)?;
    require!(vaa_guardian_set_index == guardian_set.index, BridgeError::InvalidGuardianSet);
    
    let signatures_len = cursor.read_u8().map_err(|_| BridgeError::InvalidVAA)?;
    require!(signatures_len >= 13, BridgeError::InsufficientSignatures);
    
    // 读取签名
    let mut signatures: Vec<(u8, [u8; 65])> = Vec::new();
    for _ in 0..signatures_len {
        let guardian_index = cursor.read_u8().map_err(|_| BridgeError::InvalidVAA)?;
        let mut sig = [0u8; 65];
        
        // r (32 bytes)
        for i in 0..32 {
            sig[i] = cursor.read_u8().map_err(|_| BridgeError::InvalidVAA)?;
        }
        // s (32 bytes)
        for i in 32..64 {
            sig[i] = cursor.read_u8().map_err(|_| BridgeError::InvalidVAA)?;
        }
        // v (1 byte) - recovery id
        let v = cursor.read_u8().map_err(|_| BridgeError::InvalidVAA)?;
        sig[64] = v + 27; // secp256k1_recover expects v to be 27 or 28
        
        signatures.push((guardian_index, sig));
    }
    
    // 读取Body
    let body_start = cursor.position() as usize;
    let body = &vaa_data[body_start..];
    
    // 计算Body哈希（双重哈希）
    let body_hash = keccak::hash(body).to_bytes();
    let final_hash = keccak::hash(&body_hash).to_bytes();
    
    // 验证签名
    for (guardian_index, sig) in &signatures {
        let guardian_index = *guardian_index as usize;
        require!(guardian_index < guardian_set.guardians.len(), BridgeError::InvalidSignature);
        
        let guardian_address = &guardian_set.guardians[guardian_index];
        
        // 恢复公钥并验证
        let recovered_key = secp256k1_recover(&final_hash, sig[64] - 27, &sig[0..64])
            .map_err(|_| BridgeError::InvalidSignature)?;
        
        // 计算地址（Keccak256(public_key)[12..32]）
        let recovered_address_full = keccak::hash(&recovered_key.0).to_bytes();
        let recovered_address = &recovered_address_full[12..32];
        
        require!(
            recovered_address == guardian_address,
            BridgeError::InvalidSignature
        );
    }
    
    // 解析Body字段
    let mut body_cursor = Cursor::new(body);
    let timestamp = body_cursor.read_u32::<BigEndian>().map_err(|_| BridgeError::InvalidVAA)?;
    let nonce = body_cursor.read_u32::<BigEndian>().map_err(|_| BridgeError::InvalidVAA)?;
    let emitter_chain = body_cursor.read_u16::<BigEndian>().map_err(|_| BridgeError::InvalidVAA)?;
    
    let mut emitter_address = [0u8; 32];
    for i in 0..32 {
        emitter_address[i] = body_cursor.read_u8().map_err(|_| BridgeError::InvalidVAA)?;
    }
    
    let sequence = body_cursor.read_u64::<BigEndian>().map_err(|_| BridgeError::InvalidVAA)?;
    let consistency_level = body_cursor.read_u8().map_err(|_| BridgeError::InvalidVAA)?;
    
    // 剩余的是payload
    let payload_start = body_cursor.position() as usize;
    let payload = body[payload_start..].to_vec();
    
    // 填充PostedVAA
    let posted_vaa = &mut ctx.accounts.posted_vaa;
    posted_vaa.vaa_version = version;
    posted_vaa.guardian_set_index = vaa_guardian_set_index;
    posted_vaa.timestamp = timestamp;
    posted_vaa.nonce = nonce;
    posted_vaa.emitter_chain = emitter_chain;
    posted_vaa.emitter_address = emitter_address;
    posted_vaa.sequence = sequence;
    posted_vaa.consistency_level = consistency_level;
    posted_vaa.payload = payload;
    posted_vaa.consumed = false;
    
    msg!("VAA posted: chain={}, sequence={}", emitter_chain, sequence);
    
    Ok(())
}

