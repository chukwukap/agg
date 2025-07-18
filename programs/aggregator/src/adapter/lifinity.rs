use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::Instruction, program};
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

    let rem_slice = &rem[..needed];

    // Owner whitelist validation
    for ai in rem_slice {
        let owner = *ai.owner;
        require!(
            owner == LIFINITY_PROGRAM_ID || owner == SPL_TOKEN_ID,
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

    // At present the Lifinity swap instruction does not expose post-swap token
    // balances to the CPI caller.  When a future program version provides
    // those numbers we can surface them here instead of relying on the
    // client-supplied `min_out` hint.
    Ok((leg.in_amount, leg.min_out, needed))
}
