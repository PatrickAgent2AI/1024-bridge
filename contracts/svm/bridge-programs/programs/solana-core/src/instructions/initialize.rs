use anchor_lang::prelude::*;
use crate::state::*;

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
    guardian_set.expiration_time = 0; // Active
    
    msg!("Bridge initialized with {} guardians", guardian_set.guardians.len());
    
    Ok(())
}

