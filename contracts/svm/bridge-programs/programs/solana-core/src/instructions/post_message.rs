use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::BridgeError;

#[derive(Accounts)]
pub struct PostMessage<'info> {
    #[account(mut, seeds = [b"Bridge"], bump)]
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

pub fn post_message(
    ctx: Context<PostMessage>,
    nonce: u32,
    payload: Vec<u8>,
    consistency_level: u8,
) -> Result<()> {
    let bridge = &ctx.accounts.bridge;
    
    // 检查Bridge是否暂停
    require!(!bridge.paused, BridgeError::BridgePaused);
    
    // 检查payload大小
    require!(payload.len() <= 1024, BridgeError::PayloadTooLarge);
    
    // 获取并递增序列号
    let sequence = &mut ctx.accounts.sequence;
    let current_sequence = sequence.sequence;
    sequence.sequence += 1;
    
    // 填充消息
    let message = &mut ctx.accounts.message;
    message.consistency_level = consistency_level;
    message.emitter = ctx.accounts.emitter.key();
    message.sequence = current_sequence;
    message.timestamp = Clock::get()?.unix_timestamp as u32;
    message.nonce = nonce;
    message.payload = payload.clone();
    
    // 发出事件日志
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

