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
    #[msg("Fee vault mint does not match output mint")]
    FeeVaultMintMismatch,
    #[msg("First remaining account owner mismatch (expected program id)")]
    InvalidProgramId,
    #[msg("Protocol is paused")]
    Paused,
    #[msg("Unauthorized: admin signature required")]
    Unauthorized,
    #[msg("Mint continuity mismatch between swap legs or accounts")]
    MintMismatch,
    #[msg("Route must contain at least one leg")]
    NoLegs,
}
