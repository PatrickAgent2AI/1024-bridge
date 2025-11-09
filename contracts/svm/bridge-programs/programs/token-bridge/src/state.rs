use anchor_lang::prelude::*;

#[account]
pub struct BridgeConfig {
    pub authority: Pubkey,
    pub exchange_enabled: bool,
    pub default_fee_bps: u16,
    pub fee_recipient: Pubkey,
    pub paused: bool,
}

impl BridgeConfig {
    pub const LEN: usize = 32 + 1 + 2 + 32 + 1;
}

#[account]
pub struct TokenBinding {
    pub source_chain: u16,
    pub source_token: [u8; 32],
    pub target_chain: u16,
    pub target_token: [u8; 32],
    pub rate_numerator: u64,
    pub rate_denominator: u64,
    pub use_external_price: bool,
    pub amm_program_id: Pubkey,
    pub enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

impl TokenBinding {
    pub const LEN: usize = 2 + 32 + 2 + 32 + 8 + 8 + 1 + 32 + 1 + 8 + 8;
}

