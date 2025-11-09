use anchor_lang::prelude::*;
use anchor_lang::solana_program;

declare_id!("worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth");

pub mod state;
pub mod error;

use state::*;
use error::*;

#[program]
pub mod solana_core {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        guardian_set_index: u32,
        guardians: Vec<[u8; 20]>,
        message_fee: u64,
    ) -> Result<()> {
        let bridge = &mut ctx.accounts.bridge;
        bridge.guardian_set_index = guardian_set_index;
        bridge.message_fee = message_fee;
        bridge.paused = false;

        let guardian_set = &mut ctx.accounts.guardian_set;
        guardian_set.index = guardian_set_index;
        guardian_set.guardians = guardians;
        guardian_set.creation_time = Clock::get()?.unix_timestamp;
        guardian_set.expiration_time = 0;

        Ok(())
    }

    pub fn post_message(
        ctx: Context<PostMessage>,
        nonce: u32,
        payload: Vec<u8>,
        consistency_level: u8,
    ) -> Result<()> {
        let bridge = &ctx.accounts.bridge;
        require!(!bridge.paused, BridgeError::BridgePaused);

        let payload_data = if payload.len() > 200 {
            vec![]
        } else {
            payload
        };

        let message = &mut ctx.accounts.message;
        message.consistency_level = consistency_level;
        message.emitter = ctx.accounts.emitter.key();
        message.nonce = nonce;
        message.payload = payload_data;
        message.timestamp = Clock::get()?.unix_timestamp as u32;

        let sequence = &mut ctx.accounts.sequence;
        message.sequence = sequence.sequence;
        sequence.sequence += 1;

        Ok(())
    }

    pub fn init_vaa_buffer(
        ctx: Context<InitVaaBuffer>,
        vaa_size: u32,
    ) -> Result<()> {
        let buffer = &mut ctx.accounts.vaa_buffer;
        buffer.total_size = vaa_size;
        buffer.written_size = 0;
        buffer.data = vec![0; vaa_size as usize];
        buffer.finalized = false;
        Ok(())
    }

    pub fn append_vaa_chunk(
        ctx: Context<AppendVaaChunk>,
        chunk: Vec<u8>,
        offset: u32,
    ) -> Result<()> {
        let buffer = &mut ctx.accounts.vaa_buffer;
        require!(!buffer.finalized, BridgeError::InvalidVAA);
        
        let end_offset = offset as usize + chunk.len();
        require!(end_offset <= buffer.total_size as usize, BridgeError::InvalidVAA);
        
        buffer.data[offset as usize..end_offset].copy_from_slice(&chunk);
        buffer.written_size = end_offset as u32;
        
        Ok(())
    }

    pub fn post_vaa(
        ctx: Context<PostVAA>,
        emitter_chain: u16,
        emitter_address: [u8; 32],
        sequence: u64,
    ) -> Result<()> {
        let vaa_buffer = &mut ctx.accounts.vaa_buffer;
        require!(vaa_buffer.written_size == vaa_buffer.total_size, BridgeError::InvalidVAA);
        
        let vaa = &vaa_buffer.data;
        
        require!(vaa.len() >= 6, BridgeError::InvalidVAA);

        let version = vaa[0];
        require!(version == 1, BridgeError::InvalidVAA);

        let guardian_set_index = u32::from_be_bytes([vaa[1], vaa[2], vaa[3], vaa[4]]);
        let signatures_len = vaa[5] as usize;

        require!(
            guardian_set_index == ctx.accounts.guardian_set.index,
            BridgeError::InvalidGuardianSet
        );

        require!(
            signatures_len >= 13,
            BridgeError::InsufficientSignatures
        );

        let body_offset = 6 + signatures_len * 66;
        require!(vaa.len() > body_offset + 51, BridgeError::InvalidVAA);

        let body = &vaa[body_offset..];
        
        // Verify signatures using secp256k1
        // Note: Full signature verification with secp256k1_recover is computationally expensive
        // In production, this should be done via secp256k1 precompile instruction
        // For now, we verify the signature count and guardian indices
        let body_hash = solana_program::keccak::hash(body);
        let double_hash = solana_program::keccak::hash(body_hash.as_ref());
        
        let signatures_start = 6;
        let mut verified_indices = std::collections::HashSet::new();
        
        for i in 0..signatures_len {
            let sig_offset = signatures_start + i * 66;
            let guardian_index = vaa[sig_offset] as usize;
            
            // Verify guardian index is valid
            require!(
                guardian_index < ctx.accounts.guardian_set.guardians.len(),
                BridgeError::InvalidGuardianSet
            );
            
            // Verify no duplicate indices
            require!(
                verified_indices.insert(guardian_index),
                BridgeError::InvalidSignature
            );
            
            let r = &vaa[sig_offset + 1..sig_offset + 33];
            let s = &vaa[sig_offset + 33..sig_offset + 65];
            let recovery_id = vaa[sig_offset + 65];
            
            // Perform signature verification
            let mut signature_data = [0u8; 64];
            signature_data[..32].copy_from_slice(r);
            signature_data[32..].copy_from_slice(s);
            
            let recovered_pubkey = solana_program::secp256k1_recover::secp256k1_recover(
                &double_hash.to_bytes(),
                recovery_id,
                &signature_data,
            ).map_err(|_| BridgeError::InvalidSignature)?;
            
            // Convert recovered public key to Ethereum address
            let pubkey_hash = solana_program::keccak::hash(&recovered_pubkey.to_bytes());
            let recovered_address = &pubkey_hash.to_bytes()[12..32];
            
            // Verify the recovered address matches the guardian
            let expected_guardian = &ctx.accounts.guardian_set.guardians[guardian_index];
            require!(
                recovered_address == expected_guardian,
                BridgeError::InvalidSignature
            );
        }
        
        require!(
            verified_indices.len() >= 13,
            BridgeError::InsufficientSignatures
        );
        
        let timestamp = u32::from_be_bytes([body[0], body[1], body[2], body[3]]);
        let nonce = u32::from_be_bytes([body[4], body[5], body[6], body[7]]);
        let vaa_emitter_chain = u16::from_be_bytes([body[8], body[9]]);
        let mut vaa_emitter_address = [0u8; 32];
        vaa_emitter_address.copy_from_slice(&body[10..42]);
        let vaa_sequence = u64::from_be_bytes([body[42], body[43], body[44], body[45], body[46], body[47], body[48], body[49]]);
        let consistency_level = body[50];
        let payload = body[51..].to_vec();
        
        // Verify that provided parameters match VAA content
        require!(emitter_chain == vaa_emitter_chain, BridgeError::InvalidVAA);
        require!(emitter_address == vaa_emitter_address, BridgeError::InvalidVAA);
        require!(sequence == vaa_sequence, BridgeError::InvalidVAA);

        let posted_vaa = &mut ctx.accounts.posted_vaa;
        posted_vaa.vaa_version = version;
        posted_vaa.guardian_set_index = guardian_set_index;
        posted_vaa.timestamp = timestamp;
        posted_vaa.nonce = nonce;
        posted_vaa.emitter_chain = vaa_emitter_chain;
        posted_vaa.emitter_address = vaa_emitter_address;
        posted_vaa.sequence = vaa_sequence;
        posted_vaa.consistency_level = consistency_level;
        posted_vaa.payload = payload;
        posted_vaa.consumed = false;

        Ok(())
    }

    pub fn update_guardian_set(
        ctx: Context<UpdateGuardianSet>,
    ) -> Result<()> {
        let vaa_buffer = &ctx.accounts.vaa_buffer;
        require!(vaa_buffer.written_size == vaa_buffer.total_size, BridgeError::InvalidVAA);
        
        let vaa = &vaa_buffer.data;
        
        require!(vaa.len() >= 6, BridgeError::InvalidVAA);

        let body_offset = 6 + (vaa[5] as usize) * 66;
        let body = &vaa[body_offset..];

        require!(body.len() >= 51, BridgeError::InvalidVAA);
        let payload = &body[51..];

        require!(payload.len() >= 8, BridgeError::InvalidVAA);
        require!(payload[0] == 0x01, BridgeError::InvalidVAA);
        require!(payload[1] == 0x02, BridgeError::InvalidVAA);

        let new_index = u32::from_be_bytes([payload[4], payload[5], payload[6], payload[7]]);

        let guardian_count = ((payload.len() - 8) / 20) as usize;
        let mut new_guardians = Vec::with_capacity(guardian_count);
        
        for i in 0..guardian_count {
            let mut guardian = [0u8; 20];
            guardian.copy_from_slice(&payload[8 + i * 20..8 + (i + 1) * 20]);
            new_guardians.push(guardian);
        }

        let bridge = &mut ctx.accounts.bridge;
        bridge.guardian_set_index = new_index;

        let new_guardian_set = &mut ctx.accounts.new_guardian_set;
        new_guardian_set.index = new_index;
        new_guardian_set.guardians = new_guardians;
        new_guardian_set.creation_time = Clock::get()?.unix_timestamp;
        new_guardian_set.expiration_time = 0;

        let current_guardian_set = &mut ctx.accounts.current_guardian_set;
        current_guardian_set.expiration_time = (Clock::get()?.unix_timestamp + 7 * 86400) as u32;

        Ok(())
    }

    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        let bridge = &mut ctx.accounts.bridge;
        bridge.paused = paused;
        Ok(())
    }

}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + Bridge::LEN,
        seeds = [b"Bridge"],
        bump
    )]
    pub bridge: Account<'info, Bridge>,

    #[account(
        init,
        payer = payer,
        space = 8 + GuardianSet::LEN,
        seeds = [b"GuardianSet", b"\x00\x00\x00\x00".as_ref()],
        bump
    )]
    pub guardian_set: Account<'info, GuardianSet>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PostMessage<'info> {
    #[account(
        seeds = [b"Bridge"],
        bump
    )]
    pub bridge: Account<'info, Bridge>,

    #[account(
        init,
        payer = payer,
        space = 8 + PostedMessage::LEN
    )]
    pub message: Account<'info, PostedMessage>,

    /// CHECK: Emitter can be:
    /// - User wallet (direct call): passed as Signer's AccountInfo
    /// - Program ID (CPI call): passed as program's AccountInfo
    /// - PDA (advanced): passed with invoke_signed
    /// Security: Guardian validates emitter address in whitelist
    pub emitter: AccountInfo<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Sequence::LEN,
        seeds = [b"Sequence", emitter.key().as_ref()],
        bump
    )]
    pub sequence: Account<'info, Sequence>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(emitter_chain: u16, emitter_address: [u8; 32], sequence: u64)]
pub struct PostVAA<'info> {
    #[account(
        seeds = [b"Bridge"],
        bump
    )]
    pub bridge: Account<'info, Bridge>,

    pub guardian_set: Account<'info, GuardianSet>,

    #[account(mut)]
    pub vaa_buffer: Account<'info, VaaBuffer>,

    #[account(
        init,
        payer = payer,
        space = 8 + PostedVAA::LEN,
        seeds = [
            b"PostedVAA",
            emitter_chain.to_le_bytes().as_ref(),
            emitter_address.as_ref(),
            sequence.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub posted_vaa: Account<'info, PostedVAA>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateGuardianSet<'info> {
    #[account(
        mut,
        seeds = [b"Bridge"],
        bump
    )]
    pub bridge: Account<'info, Bridge>,

    #[account(mut)]
    pub current_guardian_set: Account<'info, GuardianSet>,

    #[account(mut)]
    pub vaa_buffer: Account<'info, VaaBuffer>,

    /// new_guardian_set and upgrade_vaa are created as Keypair accounts
    /// They need to be passed in and signed by the caller
    #[account(
        init,
        payer = payer,
        space = 8 + GuardianSet::LEN
    )]
    pub new_guardian_set: Account<'info, GuardianSet>,

    #[account(
        init,
        payer = payer,
        space = 8 + PostedVAA::LEN
    )]
    pub upgrade_vaa: Account<'info, PostedVAA>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(
        mut,
        seeds = [b"Bridge"],
        bump
    )]
    pub bridge: Account<'info, Bridge>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct InitVaaBuffer<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + VaaBuffer::MAX_SIZE
    )]
    pub vaa_buffer: Account<'info, VaaBuffer>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AppendVaaChunk<'info> {
    #[account(mut)]
    pub vaa_buffer: Account<'info, VaaBuffer>,

    pub payer: Signer<'info>,
}
