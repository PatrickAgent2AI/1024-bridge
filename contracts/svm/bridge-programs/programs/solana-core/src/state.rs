use anchor_lang::prelude::*;

#[account]
pub struct Bridge {
    pub guardian_set_index: u32,
    pub message_fee: u64,
    pub paused: bool,
    pub authority: Pubkey,
}

impl Bridge {
    pub const LEN: usize = 4 + 8 + 1 + 32;
}

#[account]
pub struct GuardianSet {
    pub index: u32,
    pub guardians: Vec<[u8; 20]>,
    pub creation_time: i64,
    pub expiration_time: u32,
}

impl GuardianSet {
    pub const LEN: usize = 4 + (4 + 19 * 20) + 8 + 4;
}

#[account]
pub struct PostedMessage {
    pub consistency_level: u8,
    pub emitter: Pubkey,
    pub sequence: u64,
    pub timestamp: u32,
    pub nonce: u32,
    pub payload: Vec<u8>,
}

impl PostedMessage {
    pub const LEN: usize = 1 + 32 + 8 + 4 + 4 + (4 + 1024);
}

#[account]
pub struct PostedVAA {
    pub vaa_version: u8,
    pub guardian_set_index: u32,
    pub timestamp: u32,
    pub nonce: u32,
    pub emitter_chain: u16,
    pub emitter_address: [u8; 32],
    pub sequence: u64,
    pub consistency_level: u8,
    pub payload: Vec<u8>,
    pub consumed: bool,
}

impl PostedVAA {
    pub const LEN: usize = 1 + 4 + 4 + 4 + 2 + 32 + 8 + 1 + (4 + 1024) + 1;
}

#[account]
pub struct Sequence {
    pub sequence: u64,
}

impl Sequence {
    pub const LEN: usize = 8;
}

#[account]
pub struct VaaBuffer {
    pub total_size: u32,
    pub written_size: u32,
    pub data: Vec<u8>,
    pub finalized: bool,
}

impl VaaBuffer {
    pub const MAX_SIZE: usize = 4 + 4 + (4 + 2048) + 1;
}

