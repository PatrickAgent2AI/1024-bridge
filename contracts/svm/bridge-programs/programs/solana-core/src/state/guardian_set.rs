use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct GuardianSet {
    /// Guardian Set索引
    pub index: u32,
    
    /// Guardian地址列表（Ethereum地址格式，20字节）
    pub guardians: Vec<[u8; 20]>,
    
    /// 创建时间
    pub creation_time: i64,
    
    /// 过期时间（0 = active）
    pub expiration_time: u32,
}

impl GuardianSet {
    pub const MAX_LEN: usize = 8 + 4 + (4 + 19 * 20) + 8 + 4; // discriminator + fields
}

