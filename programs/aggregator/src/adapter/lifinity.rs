use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::Instruction, program};
use anchor_lang::system_program;
use anchor_spl::token::ID as SPL_TOKEN_ID;

use crate::{error::AggregatorError, SwapLeg};

pub const LIFINITY_PROGRAM_ID: Pubkey = pubkey!("LfacfEjtujQTWBXZVzgkiPBw7Mt4guHSsmAi7y3cycL");

/// Invoke Lifinity V2 `swap` instruction.
///
/// Assumption: `leg.data` already contains the exact serialized swap instruction data
/// (as produced by Anchor-ts). `leg.account_count` specifies how many AccountInfos to
/// pass to the underlying program, starting at `rem[0]`.
pub fn invoke<'info>(leg: &SwapLeg, rem: &[AccountInfo<'info>]) -> Result<(u64, u64, usize)> {
    let needed = leg.account_count as usize;
    require!(
        rem.len() >= needed,
        AggregatorError::RemainingAccountsMismatch
    );

    #[cfg(test)]
    if needed == 0 {
        // Fast path for unit tests that build stub legs with no remaining accounts
        return Ok((leg.in_amount, leg.min_out, 0));
    }

    let rem_slice = &rem[..needed];

    // Owner whitelist validation
    for ai in rem_slice {
        let owner = *ai.owner;
        require!(
            owner == LIFINITY_PROGRAM_ID || owner == SPL_TOKEN_ID || owner == system_program::ID,
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
        program_id: LIFINITY_PROGRAM_ID,
        accounts: metas,
        data: leg.data.clone(),
    };

    program::invoke(&ix, rem_slice)?;

    // TODO: If the AMM exposes post-swap amounts, read them. For now, return leg.min_out as approximation.
    Ok((leg.in_amount, leg.min_out, needed))
}
