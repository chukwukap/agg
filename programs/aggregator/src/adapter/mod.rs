pub mod lifinity;
pub mod orca;

use crate::{error::AggregatorError, DexId, RouteAccounts, SwapLeg};
use anchor_lang::prelude::*;

pub fn dispatch<'info>(
    ctx: &CpiContext<'_, '_, '_, 'info, RouteAccounts<'info>>,
    leg: &SwapLeg,
    rem: &[AccountInfo<'info>],
) -> Result<(u64, u64, usize)> {
    match leg.dex_id {
        DexId::LifinityV2 => lifinity::invoke(ctx, leg, rem),
        DexId::OrcaWhirlpool => orca::invoke(ctx, leg, rem),
        _ => Err(AggregatorError::UnknownDex.into()),
    }
}
