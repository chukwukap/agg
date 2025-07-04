use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};

mod adapter;
pub mod error;

use error::AggregatorError;

declare_id!("81VEHHWGikHo5wkBAPRZQUJs5LY5Yg5zrooifw27PbXt");

#[program]
pub mod aggregator {
    use super::*;

    /// Route executes an arbitrary multi-leg swap path.
    pub fn route(
        ctx: Context<RouteAccounts>,
        legs: Vec<SwapLeg>,
        user_max_in: u64,
        user_min_out: u64,
        fee_bps: u16,
    ) -> Result<()> {
        let mut rem_accs = ctx.remaining_accounts;
        let mut spent_total: u64 = 0;
        let mut out_amount: u64 = 0;

        for (i, leg) in legs.iter().enumerate() {
            // Each adapter will consume some of the remaining accounts slice
            let (spent, received, consumed) = adapter::dispatch(leg, rem_accs)?;
            spent_total = spent_total
                .checked_add(spent)
                .ok_or(ErrorCode::NumericalOverflow)?;
            out_amount = received;
            require!(
                consumed <= rem_accs.len(),
                AggregatorError::RemainingAccountsMismatch
            );
            rem_accs = &rem_accs[consumed..];

            // For legs after first, make sure the previous output mint equals current input expected
            if i == 0 {
                require!(
                    spent_total <= user_max_in,
                    AggregatorError::TooManyTokensSpent
                );
            }
        }

        require!(
            out_amount >= user_min_out,
            AggregatorError::SlippageExceeded
        );

        // Ensure fee vault mint matches the final output mint to prevent griefing.
        require_keys_eq!(
            ctx.accounts.fee_vault.mint,
            ctx.accounts.user_destination.mint,
            AggregatorError::FeeVaultMintMismatch
        );

        // Fee: proportion of out_amount
        let fee_amount: u64 = ((out_amount as u128 * fee_bps as u128) / 10_000u128)
            .try_into()
            .map_err(|_| ErrorCode::NumericalOverflow)?;
        let _user_receive = out_amount
            .checked_sub(fee_amount)
            .ok_or(ErrorCode::NumericalOverflow)?;

        #[cfg(not(test))]
        if fee_amount > 0 {
            let cpi_ctx = token::Transfer {
                from: ctx.accounts.user_destination.to_account_info(),
                to: ctx.accounts.fee_vault.to_account_info(),
                authority: ctx.accounts.user_authority.to_account_info(),
            };
            token::transfer(
                CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_ctx),
                fee_amount,
            )?;
        }

        // Final state: tokens already in user_destination (minus fee). No extra action.
        Ok(())
    }
}

#[derive(Accounts)]
pub struct RouteAccounts<'info> {
    // User
    #[account(signer)]
    pub user_authority: Signer<'info>,

    #[account(mut)]
    pub user_source: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_destination: Account<'info, TokenAccount>,

    // Fee collector
    #[account(mut)]
    pub fee_vault: Account<'info, TokenAccount>,

    // Programs
    pub token_program: Program<'info, Token>,
    /// CHECK: Compute budget program
    pub compute_budget: AccountInfo<'info>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum DexId {
    LifinityV2 = 0,
    OrcaWhirlpool = 1,
    SolarCp = 2,
    SolarClmm = 3,
    Invariant = 4,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SwapLeg {
    pub dex_id: DexId,
    pub in_amount: u64,
    pub min_out: u64,
    pub account_count: u8, // Number of AccountInfos following in remaining_accounts
    pub data: Vec<u8>,     // Raw instruction data for the adapter
}

#[error_code]
pub enum ErrorCode {
    #[msg("Overflow")]
    NumericalOverflow,
}
