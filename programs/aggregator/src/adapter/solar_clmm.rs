use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::Instruction, program};

use crate::{error::AggregatorError, SwapLeg};

/// TODO: replace with real Solar CLMM program ID.
pub const SOLAR_CLMM_PROGRAM_ID: Pubkey = pubkey!("CLsiWiZcSolarCLMMMMMM1qW8xvci2cCDgkRrFpo4KsF");

pub fn invoke<'info>(leg: &SwapLeg, rem: &[AccountInfo<'info>]) -> Result<(u64, u64, usize)> {
    let needed = leg.account_count as usize;
    require!(
        rem.len() >= needed,
        AggregatorError::RemainingAccountsMismatch
    );

    let rem_slice = &rem[..needed];
    let metas: Vec<_> = rem_slice
        .iter()
        .map(|ai| anchor_lang::solana_program::instruction::AccountMeta {
            pubkey: *ai.key,
            is_signer: ai.is_signer,
            is_writable: ai.is_writable,
        })
        .collect();

    let ix = Instruction {
        program_id: SOLAR_CLMM_PROGRAM_ID,
        accounts: metas,
        data: leg.data.clone(),
    };
    program::invoke(&ix, rem_slice)?;

    Ok((leg.in_amount, leg.min_out, needed))
}
