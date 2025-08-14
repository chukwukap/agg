#![allow(deprecated)]
use crate::state::Config;
use anchor_lang::prelude::*;
use anchor_lang::system_program::System;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::{self, Token, TokenAccount};

mod adapter;
pub mod error;
pub mod state;

use error::AggregatorError;

declare_id!("2De6Tg3Snwste9Bv73YJ9xLC12whrPnisdXBmTMqUv4j");

#[program]
pub mod aggregator {
    use super::*;

    /// Route executes a user-supplied swap path through one or more DEX adapters.  
    ///
    /// * `legs` ‑ ordered list of [`SwapLeg`] descriptions. Each leg specifies which
    ///   adapter (`dex_id`) to call, the expected input/output SPL mints and the raw
    ///   CPI data blob that will be forwarded to the adapter.  
    /// * `user_max_in` ‑ hard cap on the number of input tokens the user is willing
    ///   to spend across the whole route (**checked after execution** using the real
    ///   balance delta).  
    /// * `user_min_out` ‑ minimum number of destination tokens the user expects to
    ///   receive in total (**true anti-slippage check** – evaluated post-swap using
    ///   the actual output).
    ///
    /// Security-wise the instruction enforces:  
    /// 1. protocol pause switch  
    /// 2. mint continuity between legs  
    /// 3. fee-vault mint/address correctness  
    /// 4. accurate spend / receive accounting driven by live token balances  
    /// 5. automatic fee transfer to the configured vault  
    ///
    /// The protocol fee ( `cfg.fee_bps` ) is **not** provided by the client anymore;
    /// it is read exclusively from the on-chain [`Config`] PDA.
    pub fn route(
        ctx: Context<RouteAccounts>,
        legs: Vec<SwapLeg>,
        user_max_in: u64,
        user_min_out: u64,
    ) -> Result<()> {
        let mut rem_accs = ctx.remaining_accounts;

        // ------------------------------------------------------------------
        // Snapshot balances – we'll use the deltas later to compute the exact
        // amount spent/received and to implement slippage + fee checks.
        // ------------------------------------------------------------------
        let pre_src_balance = ctx.accounts.user_source.amount;
        let pre_dest_balance = ctx.accounts.user_destination.amount;

        // Governance config
        let cfg = &ctx.accounts.config;

        // ------------------------------------------------------------------
        // Global safety gates & basic route sanity checks
        // ------------------------------------------------------------------
        // 1) Protocol pause switch
        require!(!cfg.paused, AggregatorError::Paused);

        // 2) Ensure token accounts are controlled by the caller (fail-fast)
        require_keys_eq!(
            ctx.accounts.user_source.owner,
            ctx.accounts.user_authority.key(),
            AggregatorError::Unauthorized
        );
        require_keys_eq!(
            ctx.accounts.user_destination.owner,
            ctx.accounts.user_authority.key(),
            AggregatorError::Unauthorized
        );

        // 3) Ensure first leg consumes the tokens provided in `user_source`
        if let Some(first_leg) = legs.first() {
            require_keys_eq!(
                first_leg.in_mint,
                ctx.accounts.user_source.mint,
                AggregatorError::MintMismatch
            );
        }

        // 4) Empty route not allowed – protects against accidental fee burn
        require!(legs.len() > 0, AggregatorError::NoLegs);

        // 5) Bound the number of legs
        require!(
            legs.len() <= MAX_LEGS as usize,
            AggregatorError::TooManyLegs
        );

        let mut prev_out_mint: Option<Pubkey> = None;

        for (_i, leg) in legs.iter().enumerate() {
            // Enforce mint continuity across legs (out_mint of previous == in_mint of next)
            // Mint continuity check
            if let Some(prev) = prev_out_mint {
                require_keys_eq!(leg.in_mint, prev, AggregatorError::MintMismatch);
            }

            // Each adapter will consume some of the remaining accounts slice; we ignore any reported amounts for security.
            let (_spent_hint, _received_hint, consumed) = adapter::dispatch(leg, rem_accs)?;
            // Defense-in-depth: adapter must consume exactly what the leg declares
            require!(
                consumed == leg.account_count as usize,
                AggregatorError::RemainingAccountsMismatch
            );
            require!(
                consumed <= rem_accs.len(),
                AggregatorError::RemainingAccountsMismatch
            );
            rem_accs = &rem_accs[consumed..];

            // Update prev_out_mint for next iteration
            prev_out_mint = Some(leg.out_mint);
        }

        // ------------------------------------------------------------------
        // Post-execution accounting & user-side limits
        // ------------------------------------------------------------------
        // Reload destination to fetch post-swap balance
        ctx.accounts.user_destination.reload()?;
        let post_dest_balance = ctx.accounts.user_destination.amount;
        // Reload source to compute how many tokens were actually spent
        ctx.accounts.user_source.reload()?;
        let post_src_balance = ctx.accounts.user_source.amount;
        let delta_spent = pre_src_balance
            .checked_sub(post_src_balance)
            .ok_or(ErrorCode::NumericalOverflow)?;
        require!(
            delta_spent <= user_max_in,
            AggregatorError::TooManyTokensSpent
        );
        let delta_out = post_dest_balance
            .checked_sub(pre_dest_balance)
            .ok_or(ErrorCode::NumericalOverflow)?;

        // ------------------------------------------------------------------
        // Fee calculation & transfer – based on *real* output to make fee-
        // exploitation (e.g. via hints) impossible.
        // fee_bps is the fee in basis points (1/100 of a percent)
        // formula: fee_amount = (delta_out * fee_bps) / 10_000
        // ------------------------------------------------------------------
        let fee_amount: u64 = ((delta_out as u128 * cfg.fee_bps as u128) / 10_000u128)
            .try_into()
            .map_err(|_| ErrorCode::NumericalOverflow)?;

        // Net amount that ends up in the user's destination account *after* fee deduction.
        let user_receive = delta_out
            .checked_sub(fee_amount)
            .ok_or(ErrorCode::NumericalOverflow)?;

        // Enforce the user-supplied minimum-out slippage guard using the **net** amount.
        require!(
            user_receive >= user_min_out,
            AggregatorError::SlippageExceeded
        );

        // Ensure final out mint matches user_destination mint if any legs executed
        if let Some(final_mint) = prev_out_mint {
            require_keys_eq!(
                final_mint,
                ctx.accounts.user_destination.mint,
                AggregatorError::MintMismatch
            );
        }

        // Ensure fee vault mint matches the final output mint to prevent griefing.
        require_keys_eq!(
            ctx.accounts.fee_vault.mint,
            ctx.accounts.user_destination.mint,
            AggregatorError::FeeVaultMintMismatch
        );

        // Validate that the provided fee_vault is the admin's ATA for the final out mint.
        let expected_fee_vault =
            get_associated_token_address(&cfg.admin, &ctx.accounts.user_destination.mint);
        require_keys_eq!(
            ctx.accounts.fee_vault.key(),
            expected_fee_vault,
            AggregatorError::FeeVaultMintMismatch
        );

        // Extra safety: ensure the fee vault is owned by the configured admin.
        require_keys_eq!(
            ctx.accounts.fee_vault.owner,
            cfg.admin,
            AggregatorError::FeeVaultOwnerMismatch
        );

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

        // Emit an event for analytics and auditing
        emit!(RouteExecuted {
            user: ctx.accounts.user_authority.key(),
            in_mint: ctx.accounts.user_source.mint,
            out_mint: ctx.accounts.user_destination.mint,
            total_spent: delta_spent,
            total_out: delta_out,
            fee_charged: fee_amount,
            legs: legs.len() as u8,
            fee_bps: cfg.fee_bps,
        });

        // Final state: tokens already in user_destination (minus fee). No extra action.
        Ok(())
    }

    pub fn init_config(ctx: Context<InitConfig>, fee_bps: u16) -> Result<()> {
        // Sanity-check the requested fee before writing state.
        require!(fee_bps <= 10_000, AggregatorError::InvalidFeeBps);
        let cfg = &mut ctx.accounts.config;
        cfg.admin = ctx.accounts.admin.key();
        cfg.fee_bps = fee_bps;
        cfg.paused = false;
        cfg.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn set_config(ctx: Context<Admin>, fee_bps: u16) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        require!(
            ctx.accounts.admin.key() == cfg.admin,
            AggregatorError::Unauthorized
        );

        // Validate new fee and vault before committing.
        require!(fee_bps <= 10_000, AggregatorError::InvalidFeeBps);
        cfg.fee_bps = fee_bps;
        Ok(())
    }

    pub fn pause(ctx: Context<Admin>) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        require!(
            ctx.accounts.admin.key() == cfg.admin,
            AggregatorError::Unauthorized
        );
        cfg.paused = true;
        Ok(())
    }

    pub fn unpause(ctx: Context<Admin>) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        require!(
            ctx.accounts.admin.key() == cfg.admin,
            AggregatorError::Unauthorized
        );
        cfg.paused = false;
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

    /// Global protocol config
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,

    // Programs
    pub token_program: Program<'info, Token>,
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
    pub in_mint: Pubkey,   // Expected input SPL mint for this leg
    pub out_mint: Pubkey,  // Expected output SPL mint for this leg
}

#[error_code]
pub enum ErrorCode {
    #[msg("Overflow")]
    NumericalOverflow,
}

// -------------------- Events & Constants --------------------

#[event]
pub struct RouteExecuted {
    pub user: Pubkey,
    pub in_mint: Pubkey,
    pub out_mint: Pubkey,
    pub total_spent: u64,
    pub total_out: u64,
    pub fee_charged: u64,
    pub legs: u8,
    pub fee_bps: u16,
}

/// Upper bound on route legs to keep compute and tx size predictable.
pub const MAX_LEGS: u8 = 10;

// -------------------- Governance Contexts --------------------

#[derive(Accounts)]
#[instruction(fee_bps: u16)]
pub struct InitConfig<'info> {
    #[account(mut, signer)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        seeds = [b"config"],
        bump,
        space = 8 + 32 + 2 + 1 + 1,
    )]
    pub config: Account<'info, Config>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Admin<'info> {
    #[account(mut, seeds=[b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(signer)]
    pub admin: Signer<'info>,
}
