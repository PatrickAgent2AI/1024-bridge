use anchor_lang::prelude::*;

#[error_code]
pub enum TokenBridgeError {
    #[msg("Invalid token account")]
    InvalidTokenAccount,
    
    #[msg("Insufficient balance")]
    InsufficientBalance,
    
    #[msg("Invalid payload")]
    InvalidPayload,
    
    // 代币绑定相关错误
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
    
    #[msg("Invalid target chain")]
    InvalidTargetChain,
    
    // 旧设计相关错误（已弃用）
    #[msg("[Deprecated] Wrapped token already exists")]
    WrappedTokenExists,
}

