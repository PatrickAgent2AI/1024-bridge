use anchor_lang::prelude::*;

declare_id!("worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth");

pub mod state;
pub mod error;

use state::*;

// ============================================
// 账户验证结构（必须在#[program]之前定义）
// ============================================

#[derive(Accounts)]
#[instruction(guardian_set_index: u32)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = payer,
        space = Bridge::LEN,
        seeds = [b"Bridge"],
        bump
    )]
    pub bridge: Account<'info, Bridge>,
    
    #[account(
        init,
        payer = payer,
        space = GuardianSet::MAX_LEN,
        seeds = [b"GuardianSet", guardian_set_index.to_le_bytes().as_ref()],
        bump
    )]
    pub guardian_set: Account<'info, GuardianSet>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PostMessage<'info> {
    #[account(seeds = [b"Bridge"], bump)]
    pub bridge: Account<'info, Bridge>,
    
    #[account(
        init,
        payer = payer,
        space = PostedMessage::MAX_LEN
    )]
    pub message: Account<'info, PostedMessage>,
    
    pub emitter: Signer<'info>,
    
    #[account(
        init_if_needed,
        payer = payer,
        space = Sequence::LEN,
        seeds = [b"Sequence", emitter.key().as_ref()],
        bump
    )]
    pub sequence: Account<'info, Sequence>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PostVAA<'info> {
    #[account(seeds = [b"Bridge"], bump)]
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

#[derive(Accounts)]
pub struct UpdateGuardianSet<'info> {
    #[account(mut, seeds = [b"Bridge"], bump)]
    pub bridge: Account<'info, Bridge>,
    
    #[account(
        mut,
        seeds = [b"GuardianSet", bridge.guardian_set_index.to_le_bytes().as_ref()],
        bump
    )]
    pub current_guardian_set: Account<'info, GuardianSet>,
    
    #[account(
        init,
        payer = payer,
        space = GuardianSet::MAX_LEN,
        seeds = [b"GuardianSet", (bridge.guardian_set_index + 1).to_le_bytes().as_ref()],
        bump
    )]
    pub new_guardian_set: Account<'info, GuardianSet>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(mut, seeds = [b"Bridge"], bump)]
    pub bridge: Account<'info, Bridge>,
    
    pub authority: Signer<'info>,
}

#[program]
pub mod solana_core {
    use super::*;

    /// 初始化Bridge和Guardian Set
    pub fn initialize(
        ctx: Context<Initialize>,
        guardian_set_index: u32,
        guardians: Vec<[u8; 20]>,
        message_fee: u64,
    ) -> Result<()> {
        let bridge = &mut ctx.accounts.bridge;
        bridge.guardian_set_index = guardian_set_index;
        bridge.guardian_set_expiry = 0;
        bridge.message_fee = message_fee;
        bridge.paused = false;
        
        let guardian_set = &mut ctx.accounts.guardian_set;
        guardian_set.index = guardian_set_index;
        guardian_set.guardians = guardians;
        guardian_set.creation_time = Clock::get()?.unix_timestamp;
        guardian_set.expiration_time = 0;
        
        msg!("Bridge initialized with {} guardians", guardian_set.guardians.len());
        Ok(())
    }

    /// 发送跨链消息
    pub fn post_message(
        ctx: Context<PostMessage>,
        nonce: u32,
        payload: Vec<u8>,
        consistency_level: u8,
    ) -> Result<()> {
        require!(!ctx.accounts.bridge.paused, error::BridgeError::BridgePaused);
        require!(payload.len() <= 1024, error::BridgeError::PayloadTooLarge);
        
        let sequence = &mut ctx.accounts.sequence;
        let current_sequence = sequence.sequence;
        sequence.sequence += 1;
        
        let message = &mut ctx.accounts.message;
        message.consistency_level = consistency_level;
        message.emitter = ctx.accounts.emitter.key();
        message.sequence = current_sequence;
        message.timestamp = Clock::get()?.unix_timestamp as u32;
        message.nonce = nonce;
        message.payload = payload.clone();
        
        msg!(
            "MessagePublished: emitter={}, sequence={}, nonce={}, consistency_level={}, payload={}",
            message.emitter,
            message.sequence,
            message.nonce,
            message.consistency_level,
            hex::encode(&payload)
        );
        
        Ok(())
    }

    /// 接收并验证VAA
    pub fn post_vaa(
        ctx: Context<PostVAA>,
        vaa_data: Vec<u8>,
    ) -> Result<()> {
        use byteorder::{BigEndian, ReadBytesExt};
        use std::io::Cursor;
        
        let bridge = &ctx.accounts.bridge;
        let guardian_set = &ctx.accounts.guardian_set;
        
        require!(!bridge.paused, error::BridgeError::BridgePaused);
        
        let current_time = Clock::get()?.unix_timestamp as u32;
        require!(
            guardian_set.expiration_time == 0 || current_time < guardian_set.expiration_time,
            error::BridgeError::GuardianSetExpired
        );
        
        let mut cursor = Cursor::new(&vaa_data);
        
        let version = cursor.read_u8().map_err(|_| error::BridgeError::InvalidVAA)?;
        require!(version == 1, error::BridgeError::InvalidVAA);
        
        let vaa_guardian_set_index = cursor.read_u32::<BigEndian>().map_err(|_| error::BridgeError::InvalidVAA)?;
        require!(vaa_guardian_set_index == guardian_set.index, error::BridgeError::InvalidGuardianSet);
        
        let signatures_len = cursor.read_u8().map_err(|_| error::BridgeError::InvalidVAA)?;
        require!(signatures_len >= 13, error::BridgeError::InsufficientSignatures);
        
        // 简化签名验证（暂时跳过实际的secp256k1验证）
        // TODO: 实现完整的secp256k1签名验证
        let mut signatures_count = 0u8;
        for _ in 0..signatures_len {
            let _guardian_index = cursor.read_u8().map_err(|_| error::BridgeError::InvalidVAA)?;
            // 跳过 r(32) + s(32) + v(1) = 65 bytes
            for _ in 0..65 {
                cursor.read_u8().map_err(|_| error::BridgeError::InvalidVAA)?;
            }
            signatures_count += 1;
        }
        
        require!(signatures_count >= 13, error::BridgeError::InsufficientSignatures);
        
        // 获取body部分
        let body_start = cursor.position() as usize;
        let body = &vaa_data[body_start..];
        
        let mut body_cursor = Cursor::new(body);
        let timestamp = body_cursor.read_u32::<BigEndian>().map_err(|_| error::BridgeError::InvalidVAA)?;
        let nonce = body_cursor.read_u32::<BigEndian>().map_err(|_| error::BridgeError::InvalidVAA)?;
        let emitter_chain = body_cursor.read_u16::<BigEndian>().map_err(|_| error::BridgeError::InvalidVAA)?;
        
        let mut emitter_address = [0u8; 32];
        for i in 0..32 {
            emitter_address[i] = body_cursor.read_u8().map_err(|_| error::BridgeError::InvalidVAA)?;
        }
        
        let sequence = body_cursor.read_u64::<BigEndian>().map_err(|_| error::BridgeError::InvalidVAA)?;
        let consistency_level = body_cursor.read_u8().map_err(|_| error::BridgeError::InvalidVAA)?;
        
        let payload_start = body_cursor.position() as usize;
        let payload = body[payload_start..].to_vec();
        
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

    /// 升级Guardian Set
    pub fn update_guardian_set(
        ctx: Context<UpdateGuardianSet>,
        _vaa: Vec<u8>,
    ) -> Result<()> {
        let bridge = &mut ctx.accounts.bridge;
        let current_guardian_set = &mut ctx.accounts.current_guardian_set;
        let new_guardian_set = &mut ctx.accounts.new_guardian_set;
        
        let current_time = Clock::get()?.unix_timestamp as u32;
        current_guardian_set.expiration_time = current_time + 7 * 86400;
        
        let new_index = bridge.guardian_set_index + 1;
        
        new_guardian_set.index = new_index;
        new_guardian_set.guardians = Vec::new();
        new_guardian_set.creation_time = Clock::get()?.unix_timestamp;
        new_guardian_set.expiration_time = 0;
        
        bridge.guardian_set_index = new_index;
        
        msg!("Guardian Set upgraded from {} to {}", new_index - 1, new_index);
        
        Ok(())
    }

    /// 紧急暂停
    pub fn set_paused(
        ctx: Context<SetPaused>,
        paused: bool,
    ) -> Result<()> {
        let bridge = &mut ctx.accounts.bridge;
        bridge.paused = paused;
        
        msg!("Bridge paused status set to: {}", paused);
        
        Ok(())
    }
}
