// @ts-nocheck
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Aggregator } from "../../../target/types/aggregator";
import { setupTokenAccounts, provider } from "../../utils";
import { ComputeBudgetProgram } from "@solana/web3.js";

const program = anchor.workspace.aggregator as Program<Aggregator>;

describe("adapter - orca", () => {
  it("single leg executes", async () => {
    const { ata, mint } = await setupTokenAccounts();
    const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });

    const leg = {
      dexId: { orcaWhirlpool: {} } as any,
      inAmount: new anchor.BN(200),
      minOut: new anchor.BN(180),
      accountCount: 0,
      data: Buffer.alloc(0),
      inMint: mint,
      outMint: mint,
    };

    await program.methods
      .route([leg], new anchor.BN(200), new anchor.BN(150))
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
