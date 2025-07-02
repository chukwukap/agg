#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapter;

    fn dummy_leg(dex: DexId) -> SwapLeg {
        SwapLeg {
            dex_id: dex,
            in_amount: 100,
            min_out: 90,
            account_count: 0,
            data: vec![],
        }
    }

    #[test]
    fn lifinity_adapter_basic() {
        let leg = dummy_leg(DexId::LifinityV2);
        let res = adapter::lifinity::invoke(&leg, &[]).unwrap();
        assert_eq!(res.0, 100);
        assert_eq!(res.1, 90);
        assert_eq!(res.2, 0);
    }

    #[test]
    fn orca_adapter_basic() {
        let leg = dummy_leg(DexId::OrcaWhirlpool);
        let res = adapter::orca::invoke(&leg, &[]).unwrap();
        assert_eq!(res.2, 0);
    }

    #[test]
    fn dispatch_matches() {
        let leg = dummy_leg(DexId::SolarCp);
        let res = adapter::dispatch(&leg, &[]).unwrap();
        assert_eq!(res.0, 100);
    }

    #[test]
    fn route_two_leg_no_fee() {
        let mut program = anchor_lang::prelude::ProgramTest::default();
        // Not creating real accounts; we invoke route directly.

        let ctx = RouteAccounts {
            user_authority: anchor_lang::prelude::Signer::try_from(&anchor_lang::prelude::Pubkey::default()).unwrap(),
            user_source: unsafe { std::mem::zeroed() },
            user_destination: unsafe { std::mem::zeroed() },
            fee_vault: unsafe { std::mem::zeroed() },
            token_program: anchor_lang::prelude::Program::<Token>::try_from(anchor_lang::prelude::Pubkey::default()).unwrap(),
            compute_budget: anchor_lang::prelude::AccountInfo::default(),
        };