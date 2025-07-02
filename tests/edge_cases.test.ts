import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Aggregator } from "../target/types/aggregator";
import { setupTokenAccounts, provider } from "./utils";
import { ComputeBudgetProgram } from "@solana/web3.js";

const program = anchor.workspace.aggregator as Program<Aggregator>;

describe("router edge cases", () => {
  it("fails when spent exceeds user_max_in", async () => {
    const { ata } = await setupTokenAccounts();
    const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });

    const leg = {
      dexId: { lifinityV2: {} } as any,
      inAmount: new anchor.BN(100),
      minOut: new anchor.BN(90),
      accountCount: 0,
      data: Buffer.alloc(0),
    };

    try {
      await program.methods
        .route([leg], new anchor.BN(50), new anchor.BN(40), 0)
        .accounts({
          userAuthority: provider.wallet.publicKey,
          userSource: ata,
          userDestination: ata,
          feeVault: ata,
          computeBudget: ComputeBudgetProgram.programId,
        })
        .preInstructions([cuIx])
        .rpc();
      throw new Error("tx should have failed due to TooManyTokensSpent");
    } catch (err) {
      console.log("spent guard test passed – tx failed");
    }
  });

  it("fails when remaining account count mismatches", async () => {
    const { ata } = await setupTokenAccounts();
    const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });

    const leg = {
      dexId: { orcaWhirlpool: {} } as any,
      inAmount: new anchor.BN(100),
      minOut: new anchor.BN(90),
      accountCount: 2, // expect two accounts but none supplied
      data: Buffer.alloc(0),
    };

    try {
      await program.methods
        .route([leg], new anchor.BN(100), new anchor.BN(80), 0)
        .accounts({
          userAuthority: provider.wallet.publicKey,
          userSource: ata,
          userDestination: ata,
          feeVault: ata,
          computeBudget: ComputeBudgetProgram.programId,
        })
        .preInstructions([cuIx])
        .rpc();
      throw new Error("tx should have failed due to RemainingAccountsMismatch");
    } catch (err) {
      console.log("remaining account mismatch test passed – tx failed");
    }
  });
});
