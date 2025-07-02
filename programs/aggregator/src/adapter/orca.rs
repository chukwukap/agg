use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::Instruction, program};

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

    #[cfg(not(test))]
    program::invoke(&ix, rem_slice)?;

    Ok((leg.in_amount, leg.min_out, needed))
}
