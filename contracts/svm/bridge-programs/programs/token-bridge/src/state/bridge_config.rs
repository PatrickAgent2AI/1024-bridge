use anchor_lang::prelude::*;

/// BridgeConfig账户：存储桥接全局配置和管理员权限
#[account]
pub struct BridgeConfig {
    /// 管理员公钥
    pub authority: Pubkey,
    
    /// 是否启用跨链兑换功能
    pub exchange_enabled: bool,
    
    /// 默认兑换手续费（基点，10000=100%）
    pub default_fee_bps: u16,
    
    /// 手续费接收账户
    pub fee_recipient: Pubkey,
    
    /// 暂停状态
    pub paused: bool,
}

impl BridgeConfig {
    pub const LEN: usize = 8 + 32 + 1 + 2 + 32 + 1;
}

