use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct PostedMessage {
    /// 一致性级别
    pub consistency_level: u8,
    
    /// 发送者公钥
    pub emitter: Pubkey,
    
    /// 序列号
    pub sequence: u64,
    
    /// 时间戳
    pub timestamp: u32,
    
    /// 随机数
    pub nonce: u32,
    
    /// 消息载荷
    pub payload: Vec<u8>,
}

impl PostedMessage {
    pub const MAX_LEN: usize = 8 + 1 + 32 + 8 + 4 + 4 + (4 + 1024); // discriminator + fields + max payload
}

