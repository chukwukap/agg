pub mod invariant;
pub mod lifinity;
pub mod orca;
pub mod solar_clmm;
pub mod solar_cp;

use crate::{DexId, SwapLeg};
use anchor_lang::prelude::*;

/// Dispatches a `SwapLeg` to the correct AMM adapter.
/// Returns a tuple `(spent_in, received_out, accounts_consumed)`.
///
/// * `spent_in` – tokens actually spent from user source.
/// * `received_out` – tokens received to forward into next leg (or final out).
/// * `accounts_consumed` – length of the slice of remaining accounts consumed by the adapter.
#[inline(always)]
pub fn dispatch<'info>(leg: &SwapLeg, rem: &[AccountInfo<'info>]) -> Result<(u64, u64, usize)> {
    match leg.dex_id {
        DexId::LifinityV2 => lifinity::invoke(leg, rem),
        DexId::OrcaWhirlpool => orca::invoke(leg, rem),
        DexId::SolarCp => solar_cp::invoke(leg, rem),
        DexId::SolarClmm => solar_clmm::invoke(leg, rem),
        DexId::Invariant => invariant::invoke(leg, rem),
    }
}
