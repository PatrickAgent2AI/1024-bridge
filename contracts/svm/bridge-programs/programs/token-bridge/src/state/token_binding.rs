use anchor_lang::prelude::*;

/// TokenBinding账户：存储代币跨链映射关系和兑换配置
#[account]
pub struct TokenBinding {
    /// 源链ID
    pub source_chain: u16,
    
    /// 源链代币地址（32字节统一格式）
    pub source_token: [u8; 32],
    
    /// 目标链ID
    pub target_chain: u16,
    
    /// 目标链代币地址（32字节统一格式）
    pub target_token: [u8; 32],
    
    /// 兑换比率分子
    pub rate_numerator: u64,
    
    /// 兑换比率分母
    pub rate_denominator: u64,
    
    /// 是否启用外部AMM定价
    pub use_external_price: bool,
    
    /// 外部AMM程序ID（预留）
    pub amm_program_id: Pubkey,
    
    /// 是否启用
    pub enabled: bool,
    
    /// 创建时间
    pub created_at: i64,
    
    /// 最后更新时间
    pub updated_at: i64,
}

impl TokenBinding {
    pub const LEN: usize = 8 + // discriminator
        2 + // source_chain
        32 + // source_token
        2 + // target_chain
        32 + // target_token
        8 + // rate_numerator
        8 + // rate_denominator
        1 + // use_external_price
        32 + // amm_program_id
        1 + // enabled
        8 + // created_at
        8; // updated_at
}

