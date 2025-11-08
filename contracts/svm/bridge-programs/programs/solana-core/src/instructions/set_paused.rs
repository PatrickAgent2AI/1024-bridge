use anchor_lang::prelude::*;
use crate::state::*;

#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(mut, seeds = [b"Bridge"], bump)]
    pub bridge: Account<'info, Bridge>,
    
    /// 治理权限（暂时简化为任何签名者）
    pub authority: Signer<'info>,
}

pub fn set_paused(
    ctx: Context<SetPaused>,
    paused: bool,
) -> Result<()> {
    let bridge = &mut ctx.accounts.bridge;
    bridge.paused = paused;
    
    msg!("Bridge paused status set to: {}", paused);
    
    Ok(())
}

