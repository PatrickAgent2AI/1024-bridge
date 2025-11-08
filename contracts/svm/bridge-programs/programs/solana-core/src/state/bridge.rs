use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct Bridge {
    /// 当前Guardian Set索引
    pub guardian_set_index: u32,
    
    /// Guardian Set过期时间（暂未使用，保留字段）
    pub guardian_set_expiry: u32,
    
    /// 消息手续费
    pub message_fee: u64,
    
    /// 是否暂停
    pub paused: bool,
}

impl Bridge {
    pub const LEN: usize = 8 + 4 + 4 + 8 + 1; // discriminator + fields
}

