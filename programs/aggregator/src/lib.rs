use crate::state::Config;
use anchor_lang::prelude::*;
use anchor_lang::system_program::System;
use anchor_spl::token::{self, Token, TokenAccount};

mod adapter;
pub mod error;
pub mod state;

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

        // Governance config
        let cfg = &ctx.accounts.config;

        // Protocol paused?
        require!(!cfg.paused, AggregatorError::Paused);
        // Caller-supplied fee_bps must match on-chain config to avoid mismatch
        require!(
            fee_bps == cfg.fee_bps,
            AggregatorError::FeeVaultMintMismatch
        );

        // Ensure first leg in_mint matches user's source token
        if let Some(first_leg) = legs.first() {
            require_keys_eq!(
                first_leg.in_mint,
                ctx.accounts.user_source.mint,
                AggregatorError::MintMismatch
            );
        }

        let mut prev_out_mint: Option<Pubkey> = None;

        for (i, leg) in legs.iter().enumerate() {
            // Mint continuity check
            if let Some(prev) = prev_out_mint {
                require_keys_eq!(leg.in_mint, prev, AggregatorError::MintMismatch);
            }

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

            // For legs after first, make sure the previous output mint equals current input expected (handled above)
            if i == 0 {
                require!(
                    spent_total <= user_max_in,
                    AggregatorError::TooManyTokensSpent
                );
            }

            // Update prev_out_mint for next iteration
            prev_out_mint = Some(leg.out_mint);
        }

        // Ensure final out mint matches user_destination mint if any legs executed
        if let Some(final_mint) = prev_out_mint {
            require_keys_eq!(
                final_mint,
                ctx.accounts.user_destination.mint,
                AggregatorError::MintMismatch
            );
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

        require_keys_eq!(
            ctx.accounts.fee_vault.key(),
            cfg.fee_vault,
            AggregatorError::FeeVaultMintMismatch
        );

        // Fee: proportion of out_amount
        let fee_amount: u64 = ((out_amount as u128 * cfg.fee_bps as u128) / 10_000u128)
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

    pub fn init_config(ctx: Context<InitConfig>, fee_bps: u16) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        cfg.admin = ctx.accounts.admin.key();
        cfg.fee_bps = fee_bps;
        cfg.fee_vault = ctx.accounts.fee_vault.key();
        cfg.paused = false;
        cfg.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn set_config(ctx: Context<Admin>, fee_bps: u16, fee_vault: Pubkey) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        require!(
            ctx.accounts.admin.key() == cfg.admin,
            AggregatorError::Unauthorized
        );
        cfg.fee_bps = fee_bps;
        cfg.fee_vault = fee_vault;
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
    pub in_mint: Pubkey,   // Expected input SPL mint for this leg
    pub out_mint: Pubkey,  // Expected output SPL mint for this leg
}

#[error_code]
pub enum ErrorCode {
    #[msg("Overflow")]
    NumericalOverflow,
}

// -------------------- Governance Contexts --------------------

#[derive(Accounts)]
#[instruction(fee_bps: u16)]
pub struct InitConfig<'info> {
    #[account(mut, signer)]
    pub admin: Signer<'info>,

    #[account(mut)]
    pub fee_vault: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = admin,
        seeds = [b"config"],
        bump,
        space = 8 + 32 + 2 + 32 + 1 + 1,
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
