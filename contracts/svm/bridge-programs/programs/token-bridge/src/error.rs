use anchor_lang::prelude::*;

#[error_code]
pub enum TokenBridgeError {
    #[msg("Invalid token account")]
    InvalidTokenAccount,
    
    #[msg("Insufficient balance")]
    InsufficientBalance,
    
    #[msg("Wrapped token already exists")]
    WrappedTokenExists,
    
    #[msg("Invalid payload")]
    InvalidPayload,
}

