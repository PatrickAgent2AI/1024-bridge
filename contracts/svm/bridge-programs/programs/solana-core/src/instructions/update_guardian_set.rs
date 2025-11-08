use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::BridgeError;
use byteorder::{BigEndian, ReadBytesExt};
use std::io::Cursor;

#[derive(Accounts)]
#[instruction(vaa: Vec<u8>)]
pub struct UpdateGuardianSet<'info> {
    #[account(mut, seeds = [b"Bridge"], bump)]
    pub bridge: Account<'info, Bridge>,
    
    #[account(
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

pub fn update_guardian_set(
    ctx: Context<UpdateGuardianSet>,
    vaa: Vec<u8>,
) -> Result<()> {
    // TODO: 验证VAA是治理VAA
    // 这里简化实现，假设VAA已经在调用前验证过
    
    // 解析VAA的payload（GuardianSetUpgrade）
    // Payload格式：module(1) + action(1) + chain(2) + new_index(4) + guardians(20*N)
    
    // 暂时简化：从VAA中提取新Guardian列表
    // 实际应该解析完整的VAA payload
    
    let bridge = &mut ctx.accounts.bridge;
    let current_guardian_set = &mut ctx.accounts.current_guardian_set;
    let new_guardian_set = &mut ctx.accounts.new_guardian_set;
    
    // 设置旧Guardian Set过期时间（7天后）
    let current_time = Clock::get()?.unix_timestamp as u32;
    current_guardian_set.expiration_time = current_time + 7 * 86400; // 7 days
    
    // 这里暂时使用测试数据，实际应从VAA payload解析
    // TODO: 解析VAA payload获取新Guardian列表
    let new_index = bridge.guardian_set_index + 1;
    
    // 初始化新Guardian Set
    new_guardian_set.index = new_index;
    new_guardian_set.guardians = Vec::new(); // 应从payload解析
    new_guardian_set.creation_time = Clock::get()?.unix_timestamp;
    new_guardian_set.expiration_time = 0; // Active
    
    // 更新Bridge
    bridge.guardian_set_index = new_index;
    
    msg!("Guardian Set upgraded from {} to {}", new_index - 1, new_index);
    msg!("Old set expires at: {}", current_guardian_set.expiration_time);
    
    Ok(())
}

