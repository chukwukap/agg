use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::Instruction, program};
use anchor_lang::system_program;
use anchor_spl::token::ID as SPL_TOKEN_ID;

use crate::{error::AggregatorError, SwapLeg};

/// TODO: replace with actual Invariant CLMM program ID.
pub const INVARIANT_PROGRAM_ID: Pubkey = pubkey!("So11111111111111111111111111111111111111112");

pub fn invoke<'info>(leg: &SwapLeg, rem: &[AccountInfo<'info>]) -> Result<(u64, u64, usize)> {
    let needed = leg.account_count as usize;
    require!(
        rem.len() >= needed,
        AggregatorError::RemainingAccountsMismatch
    );

    if needed == 0 {
        return Ok((leg.in_amount, leg.min_out, 0));
    }

    let rem_slice = &rem[..needed];

    for ai in rem_slice {
        let owner = *ai.owner;
        require!(
            owner == INVARIANT_PROGRAM_ID || owner == SPL_TOKEN_ID || owner == system_program::ID,
            AggregatorError::InvalidProgramId
        );
    }

    let metas: Vec<_> = rem_slice
        .iter()
        .map(|ai| anchor_lang::solana_program::instruction::AccountMeta {
            pubkey: *ai.key,
            is_signer: ai.is_signer,
            is_writable: ai.is_writable,
        })
        .collect();

    let ix = Instruction {
        program_id: INVARIANT_PROGRAM_ID,
        accounts: metas,
        data: leg.data.clone(),
    };
    program::invoke(&ix, rem_slice)?;

    Ok((leg.in_amount, leg.min_out, needed))
}
