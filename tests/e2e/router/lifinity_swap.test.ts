import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Aggregator } from "../../../target/types/aggregator";
import { createMintAndATAs, provider, getTokenAmount } from "../bootstrap";
import { ComputeBudgetProgram, PublicKey } from "@solana/web3.js";

// Program IDs – must match binaries pre-loaded by validator
const LIFINITY_PROGRAM_ID = new PublicKey(
  "LfacfEjtujQTWBXZVzgkiPBw7Mt4guHSsmAi7y3cycL"
);

const program = anchor.workspace.aggregator as Program<Aggregator>;

/*
 * This test crafts a minimal Lifinity V2 `swap` leg that simply transfers
 * tokens from `source` → `destination` vault inside the mocked pool. Because
 * we don't have the full Lifinity SDK here, we fake the instruction data to
 * empty; the adapter returns `(in,min_out)` so router math still executes and
 * fee logic is exercised against the real program (compute happens but will
 * early-exit because data len == 0). This is a smoke-test proving CPI wiring.
 */

describe("e2e – lifinity adapter wiring", () => {
  it("executes a 1-leg lifinity swap via CPI", async () => {
    const { mint, source, destination, feeVault } = await createMintAndATAs();

    const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_200_000 });

    const leg = {
      dexId: { lifinityV2: {} } as any,
      inAmount: new anchor.BN(100_000),
      minOut: new anchor.BN(90_000),
      accountCount: 3, // whirlpool + two token vaults
      data: Buffer.alloc(0),
    };

    await program.methods
      .route([leg], new anchor.BN(110_000), new anchor.BN(80_000), 50) // 0.5% fee
      .accounts({
        userAuthority: provider.wallet.publicKey,
        userSource: source,
        userDestination: destination,
        feeVault,
        computeBudget: ComputeBudgetProgram.programId,
      })
      .preInstructions([cuIx])
      .remainingAccounts([
        {
          pubkey: new PublicKey("D36zYmhG1CEV4VpWwfvX2VNfzQExgkt1PyfuzMdudH5K"),
          isSigner: false,
          isWritable: false,
        },
        {
          pubkey: new PublicKey("7k3bDHK5mVsQt1zArhcXd1LSeX776BF3nfUSKCDrkguP"),
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: new PublicKey("77DpD6PEw24kTx5cHGNyEJD7BqXc9EwP6KDAdAm8YGtS"),
          isSigner: false,
          isWritable: true,
        },
      ])
      .rpc();

    // Assert fee vault increased by 0.5 % of minOut (450)
    const feeExpected = (BigInt(90_000) * 50n) / 10_000n;
    const feeAfter = await getTokenAmount(feeVault);
    if (feeAfter !== feeExpected) {
      throw new Error(
        `fee vault mismatch expected ${feeExpected} got ${feeAfter}`
      );
    }
  });
});
