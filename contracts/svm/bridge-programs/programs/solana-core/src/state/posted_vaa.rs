use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct PostedVAA {
    /// VAA版本
    pub vaa_version: u8,
    
    /// Guardian Set索引
    pub guardian_set_index: u32,
    
    /// 时间戳
    pub timestamp: u32,
    
    /// 随机数
    pub nonce: u32,
    
    /// 发送链ID
    pub emitter_chain: u16,
    
    /// 发送者地址（32字节）
    pub emitter_address: [u8; 32],
    
    /// 序列号
    pub sequence: u64,
    
    /// 一致性级别
    pub consistency_level: u8,
    
    /// 消息载荷
    pub payload: Vec<u8>,
    
    /// 是否已被消费
    pub consumed: bool,
}

impl PostedVAA {
    pub const MAX_LEN: usize = 8 + 1 + 4 + 4 + 4 + 2 + 32 + 8 + 1 + (4 + 2048) + 1; // discriminator + fields
}

