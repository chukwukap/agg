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
}
