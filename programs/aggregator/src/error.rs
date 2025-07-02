use anchor_lang::prelude::*;

#[error_code]
pub enum AggregatorError {
    #[msg("Too many tokens spent vs user_max_in")]
    TooManyTokensSpent,
    #[msg("Not enough output (slippage)")]
    SlippageExceeded,
    #[msg("Unknown DEX id")]
    UnknownDex,
    #[msg("Insufficient remaining accounts for adapter")]
    RemainingAccountsMismatch,
}
