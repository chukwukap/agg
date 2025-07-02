import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Aggregator } from "../target/types/aggregator";
import { setupTokenAccounts, provider } from "./utils";
import { ComputeBudgetProgram } from "@solana/web3.js";

const program = anchor.workspace.aggregator as Program<Aggregator>;

describe("adapter - invariant", () => {
  it("single leg executes", async () => {
    const { ata } = await setupTokenAccounts();
    const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });

    const leg = {
      dexId: { invariant: {} } as any,
      inAmount: new anchor.BN(500),
      minOut: new anchor.BN(450),
      accountCount: 0,
      data: Buffer.alloc(0),
    };

    await program.methods
      .route([leg], new anchor.BN(500), new anchor.BN(420), 0)
      .accounts({
        userAuthority: provider.wallet.publicKey,
        userSource: ata,
        userDestination: ata,
        feeVault: ata,
        computeBudget: ComputeBudgetProgram.programId,
      })
      .preInstructions([cuIx])
      .rpc();
  });
});
