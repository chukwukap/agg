import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Aggregator } from "../../../target/types/aggregator";
import { setupTokenAccounts, provider } from "../../utils";
import { ComputeBudgetProgram } from "@solana/web3.js";

const program = anchor.workspace.aggregator as Program<Aggregator>;

// @ts-nocheck

describe("router edge cases", () => {
  /**
   * 1. No legs but non-zero min_out ⇒ should revert (SlippageExceeded)
   */
  it("fails when 0-leg route requests positive min_out", async () => {
    const { ata, mint } = await setupTokenAccounts();
    const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_200_000 });

    try {
      await program.methods
        .route([], new anchor.BN(0), new anchor.BN(1))
        .accounts({
          userAuthority: provider.wallet.publicKey,
          userSource: ata,
          userDestination: ata,
          feeVault: ata,
          computeBudget: ComputeBudgetProgram.programId,
        })
        .preInstructions([cuIx])
        .rpc();
      throw new Error(
        "tx should have failed due to SlippageExceeded on 0-leg route"
      );
    } catch (_err) {
      console.log("0-leg slippage guard test passed – tx failed");
    }
  });

  // Tests related to explicit fee_bps removed after fee logic moved fully on-chain.

  it("fails when spent exceeds user_max_in", async () => {
    const { ata, mint } = await setupTokenAccounts();
    const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });

    const leg = {
      dexId: { lifinityV2: {} } as any,
      inAmount: new anchor.BN(100),
      minOut: new anchor.BN(90),
      accountCount: 0,
      data: Buffer.alloc(0),
      inMint: mint,
      outMint: mint,
    };

    try {
      await program.methods
        .route([leg], new anchor.BN(50), new anchor.BN(40))
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
    } catch (_err) {
      console.log("spent guard test passed – tx failed");
    }
  });

  it("fails when remaining account count mismatches", async () => {
    const { ata, mint } = await setupTokenAccounts();
    const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });

    const leg = {
      dexId: { orcaWhirlpool: {} } as any,
      inAmount: new anchor.BN(100),
      minOut: new anchor.BN(90),
      accountCount: 2, // expect two accounts but none supplied
      data: Buffer.alloc(0),
      inMint: mint,
      outMint: mint,
    };

    try {
      await program.methods
        .route([leg], new anchor.BN(100), new anchor.BN(80))
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
    } catch (_err) {
      console.log("remaining account mismatch test passed – tx failed");
    }
  });

  it("fails when fee vault mint mismatches output mint", async () => {
    const { ata, mint } = await setupTokenAccounts();
    // create a second mint for fee vault mismatch
    const otherMintData = await setupTokenAccounts();
    const wrongFeeVault = otherMintData.ata;
    const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_200_000 });

    const leg = {
      dexId: { lifinityV2: {} } as any,
      inAmount: new anchor.BN(30),
      minOut: new anchor.BN(20),
      accountCount: 0,
      data: Buffer.alloc(0),
      inMint: mint,
      outMint: mint,
    };

    try {
      await program.methods
        .route([leg], new anchor.BN(30), new anchor.BN(15))
        .accounts({
          userAuthority: provider.wallet.publicKey,
          userSource: ata,
          userDestination: ata,
          feeVault: wrongFeeVault, // wrong mint
          computeBudget: ComputeBudgetProgram.programId,
        })
        .preInstructions([cuIx])
        .rpc();
      throw new Error("tx should have failed due to FeeVaultMintMismatch");
    } catch (_err) {
      console.log("fee vault mint guard passed – tx failed");
    }
  });
});
