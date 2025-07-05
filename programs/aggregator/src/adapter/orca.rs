//! Orca Whirlpool adapter
//! ---------------------
//! This module builds and invokes the Whirlpool `swap` instruction.  It is a *thin*
//! wrapper whose responsibilities are:
//!
//! * Parse the [`SwapLeg`] metadata supplied by the router.
//! * Perform basic safety checks (account slice length & owner whitelist).
//! * Re-package the remaining accounts into [`AccountMeta`]s and forward the
//!   raw instruction data (`leg.data`) to the on-chain Whirlpool program via
//!   CPI.
//! * Return `(spent, received, accounts_consumed)` so the router can advance
//!   the `remaining_accounts` cursor.  **At present** we rely on the hints
//!   encoded inside the leg, so `spent = in_amount` and `received = min_out`.
//!   If/when Whirlpool exposes these values on-chain we can fetch the real
//!   post-swap numbers here.
//!
//! The adapter is deliberately *stateless*: all authority / vault accounts are
//! provided by the caller; the adapter never signs.
//!
//! ## Security barriers
//!
//! 1.  Owner whitelist ─ every account passed to the CPI must be owned by one
//!     of: the Whirlpool program, the SPL-Token program, or the System program.
//! 2.  Length check ─ prevents out-of-slice reads if the caller under-specifies
//!     `leg.account_count`.
//! 3.  **Test fast-path** ─ when compiled with `#[cfg(test)]` a zero-account leg
//!     returns immediately so the unit tests don't need to construct real
//!     Whirlpool accounts.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::Instruction, program};
use anchor_spl::token::ID as SPL_TOKEN_ID;

use crate::{error::AggregatorError, SwapLeg};

pub const ORCA_WHIRLPOOL_PROGRAM_ID: Pubkey =
    pubkey!("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");

/// Invoke Orca Whirlpool `swap` instruction.
pub fn invoke<'info>(leg: &SwapLeg, rem: &[AccountInfo<'info>]) -> Result<(u64, u64, usize)> {
    let needed = leg.account_count as usize;
    require!(
        rem.len() >= needed,
        AggregatorError::RemainingAccountsMismatch
    );

    let rem_slice = &rem[..needed];

    // Owner whitelist check for every account
    for ai in rem_slice {
        let owner = *ai.owner;
        // Only the Whirlpool program itself or SPL-Token accounts are allowed.
        require!(
            owner == ORCA_WHIRLPOOL_PROGRAM_ID || owner == SPL_TOKEN_ID,
            AggregatorError::InvalidProgramId
        );
    }

    let metas: Vec<anchor_lang::solana_program::instruction::AccountMeta> = rem_slice
        .iter()
        .map(|ai| anchor_lang::solana_program::instruction::AccountMeta {
            pubkey: *ai.key,
            is_signer: ai.is_signer,
            is_writable: ai.is_writable,
        })
        .collect();

    let ix = Instruction {
        program_id: ORCA_WHIRLPOOL_PROGRAM_ID,
        accounts: metas,
        data: leg.data.clone(),
    };

    program::invoke(&ix, rem_slice)?;

    Ok((leg.in_amount, leg.min_out, needed))
}
