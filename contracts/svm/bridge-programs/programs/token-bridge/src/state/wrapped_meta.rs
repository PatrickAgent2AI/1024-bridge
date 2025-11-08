use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct WrappedMeta {
    /// 源链ID
    pub original_chain: u16,
    
    /// 源链代币地址
    pub original_address: [u8; 32],
    
    /// 精度
    pub decimals: u8,
}

impl WrappedMeta {
    pub const LEN: usize = 8 + 2 + 32 + 1; // discriminator + fields
}

