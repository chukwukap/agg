pub mod lifinity;
pub mod orca;

use crate::{error::AggregatorError, DexId, SwapLeg};
use anchor_lang::prelude::*;

pub fn dispatch<'info>(leg: &SwapLeg, rem: &[AccountInfo<'info>]) -> Result<(u64, u64, usize)> {
    match leg.dex_id {
        DexId::LifinityV2 => lifinity::invoke(leg, rem),
        DexId::OrcaWhirlpool => orca::invoke(leg, rem),
    }
}
