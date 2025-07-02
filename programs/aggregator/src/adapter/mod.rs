pub mod invariant;
pub mod lifinity;
pub mod orca;
pub mod solar_clmm;
pub mod solar_cp;

use crate::{error::AggregatorError, DexId, SwapLeg};
use anchor_lang::prelude::*;

pub fn dispatch<'info>(leg: &SwapLeg, rem: &[AccountInfo<'info>]) -> Result<(u64, u64, usize)> {
    match leg.dex_id {
        DexId::LifinityV2 => lifinity::invoke(leg, rem),
        DexId::OrcaWhirlpool => orca::invoke(leg, rem),
        DexId::SolarCp => solar_cp::invoke(leg, rem),
        DexId::SolarClmm => solar_clmm::invoke(leg, rem),
        DexId::Invariant => invariant::invoke(leg, rem),
    }
}
