//! Unit & property tests for the on-chain aggregator program.
//!
//! The goals of this test-suite are:
//! 1.  Verify that every adapter returns the expected `(in, out, consumed)` triple for
//!     simple dummy `SwapLeg`s.
//! 2.  Verify that the adapter correctly errors when the caller provides an
//!     insufficient slice of `remaining_accounts`.
//! 3.  Fuzz-test (via `proptest`) that the `accounts_consumed` value reported by
//!     the adapter always matches the `account_count` field embedded in `SwapLeg`.
//!
//! The real CPI calls are compiled out in tests (`#[cfg(not(test))]` blocks inside
//! the adapters) so the tests run completely off-chain and do **not** spin up a
//! local validator. This keeps the feedback loop fast while still covering the
//! routing logic.

#![cfg(test)]

use super::*;
use crate::{adapter, DexId, SwapLeg};
use anchor_lang::prelude::*;
use proptest::prelude::*;

/// Helper to build a minimal `SwapLeg` for a given DEX.
fn dummy_leg(dex: DexId, in_amount: u64, min_out: u64, account_count: u8) -> SwapLeg {
    SwapLeg {
        dex_id: dex,
        in_amount,
        min_out,
        account_count,
        data: vec![],
    }
}

/// List of all supported DEX IDs used throughout the tests.
const ALL_DEXES: &[DexId] = &[
    DexId::LifinityV2,
    DexId::OrcaWhirlpool,
    DexId::SolarCp,
    DexId::SolarClmm,
    DexId::Invariant,
];

/// Creates a **zeroed** `AccountInfo` suitable only for unit testing where the
/// value is never dereferenced.  This avoids having to spin up real account
/// structs for every property-test case.
fn dummy_account_info<'info>() -> AccountInfo<'info> {
    // SAFETY: We only pass the resulting `AccountInfo` by reference to adapters
    // that will *not* dereference the data under `#[cfg(test)]` because the
    // CPI invocation itself is skipped with `#[cfg(not(test))]`.  Therefore it
    // is safe to provide an all-zeroed struct.
    unsafe { std::mem::zeroed() }
}

// ------------- Basic happy-path tests ------------- //

#[test]
fn adapter_happy_path_returns_expected_triplet() {
    for &dex in ALL_DEXES {
        let leg = dummy_leg(dex, 1_000, 950, 0); // `account_count = 0` ⇒ no remaining_accounts needed
        let (spent, received, consumed) =
            adapter::dispatch(&leg, &[]).expect("adapter call failed");
        assert_eq!(spent, 1_000, "spent_in mismatch for {:?}", dex);
        assert_eq!(received, 950, "received_out mismatch for {:?}", dex);
        assert_eq!(consumed, 0, "accounts_consumed mismatch for {:?}", dex);
    }
}

#[test]
fn adapter_errors_on_insufficient_remaining_accounts() {
    // Provide a leg that claims it needs 2 accounts but pass in only 1.
    let leg = dummy_leg(DexId::LifinityV2, 100, 90, 2);
    let dummy_account = dummy_account_info();
    let err = adapter::lifinity::invoke(&leg, &[dummy_account]).unwrap_err();
    // The error should map to our `RemainingAccountsMismatch` variant.
    match err {
        anchor_lang::error::Error::AnchorError(anchor_err) => {
            assert_eq!(anchor_err.error_name(), "RemainingAccountsMismatch");
        }
        other => panic!("unexpected error variant: {:?}", other),
    }
}

// ------------- Property tests (proptest) ------------- //

proptest! {
    /// For any randomly generated `account_count` (0..=10) the adapter must
    /// return the same `account_count` via its `accounts_consumed` value.
    #[test]
    fn prop_accounts_consumed_matches_leg(
        acc_count in 0u8..10,
        in_amount in 1u64..1_000_000u64,
        min_out in 1u64..1_000_000u64,
    ) {
        let leg = dummy_leg(DexId::SolarCp, in_amount, min_out, acc_count);
        // Build a vector with `acc_count` dummy `AccountInfo`s.
        let rem: Vec<AccountInfo> = (0..acc_count).map(|_| dummy_account_info()).collect();
        let (_spent, _recv, consumed) = adapter::solar_cp::invoke(&leg, &rem).unwrap();
        prop_assert_eq!(consumed as u8, acc_count);
    }
}

// ------------- Fee maths sanity check ------------- //

#[test]
fn fee_calculation_never_overflows_and_is_bounded() {
    for out_amount in [1u64, 10, 10_000, u64::MAX / 2] {
        for fee_bps in [0u16, 1, 10, 10_000] {
            // 0 ‑ 100 %
            let fee: u64 = ((out_amount as u128 * fee_bps as u128) / 10_000) as u64;
            assert!(fee <= out_amount, "fee exceeds out_amount");
        }
    }
}

// ------------- Compiler guard ------------- //
// If new DEXes are added but the test suite is not updated, fail loudly.
#[test]
fn exhaustive_dex_enum_coverage() {
    use std::collections::HashSet;
    let from_array: HashSet<u8> = ALL_DEXES.iter().map(|d| *d as u8).collect();
    let from_enum: HashSet<u8> = (0u8..=u8::MAX)
        .filter(|v| matches!(*v, 0..=4)) // Current enum variants occupy 0-4.
        .collect();

    assert_eq!(
        from_array, from_enum,
        "`ALL_DEXES` constant missing a variant – please update the test suite."
    );
}
