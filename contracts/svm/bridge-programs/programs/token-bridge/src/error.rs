use anchor_lang::prelude::*;

#[error_code]
pub enum TokenBridgeError {
    #[msg("Invalid token account")]
    InvalidTokenAccount,
    
    #[msg("Insufficient balance")]
    InsufficientBalance,
    
    #[msg("Invalid payload")]
    InvalidPayload,
    
    #[msg("Token binding not found")]
    TokenBindingNotFound,
    
    #[msg("Token binding already exists")]
    TokenBindingExists,
    
    #[msg("Token binding not enabled")]
    TokenBindingNotEnabled,
    
    #[msg("Invalid exchange rate")]
    InvalidExchangeRate,
    
    #[msg("Exchange rate denominator cannot be zero")]
    ZeroDenominator,
    
    #[msg("Target token mismatch")]
    TargetTokenMismatch,
    
    #[msg("Exchange feature disabled")]
    ExchangeDisabled,
    
    #[msg("Unauthorized: not bridge authority")]
    Unauthorized,
    
    #[msg("AMM price fetch failed")]
    AMMPriceFetchFailed,
    
    #[msg("Slippage exceeded")]
    SlippageExceeded,

    #[msg("VAA already consumed")]
    VAAAlreadyConsumed,

    #[msg("Invalid target chain")]
    InvalidTargetChain,
}

