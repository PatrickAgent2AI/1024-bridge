use anchor_lang::prelude::*;

#[error_code]
pub enum BridgeError {
    #[msg("Invalid VAA")]
    InvalidVAA,
    
    #[msg("VAA already consumed")]
    VAAAlreadyConsumed,
    
    #[msg("Insufficient signatures (requires 13/19)")]
    InsufficientSignatures,
    
    #[msg("Invalid guardian set")]
    InvalidGuardianSet,
    
    #[msg("Guardian set expired")]
    GuardianSetExpired,
    
    #[msg("Invalid signature")]
    InvalidSignature,
    
    #[msg("Bridge is paused")]
    BridgePaused,
    
    #[msg("Insufficient fee")]
    InsufficientFee,
    
    #[msg("Invalid target chain")]
    InvalidTargetChain,
    
    #[msg("Amount too large")]
    AmountTooLarge,
    
    #[msg("Payload too large")]
    PayloadTooLarge,
}

