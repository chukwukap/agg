# DEX Program Binaries

This directory is **git-ignored**. Drop compiled `.so` files here so the
local validator (see `scripts/start-validator.sh`) can preload them.

Required filenames & program IDs (adapter hard-coded):

| file                | program_id                                  |
| ------------------- | ------------------------------------------- |
| `lifinity_v2.so`    | LfacfEjtujQTWBXZVzgkiPBw7Mt4guHSsmAi7y3cycL |
| `orca_whirlpool.so` | whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc |
| `solar_cp.so`       | sooGfSeXGtkLCPAMMpqkViwXxPxq8np5xpoEGoEsXXL |
| `solar_clmm.so`     | So11111111111111111111111111111111111111113 |
| `invariant_clmm.so` | So11111111111111111111111111111111111111112 |

You can **clone** these programs directly from mainnet into a temporary
ledger and copy the resulting ELF files:

```bash
solana program dump whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc lifinity_v2.so --url mainnet-beta
# repeat for each program id
```

Alternatively build from source if the AMM publishes it.
