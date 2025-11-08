use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct Sequence {
    /// 当前序列号
    pub sequence: u64,
}

impl Sequence {
    pub const LEN: usize = 8 + 8; // discriminator + sequence
}
