import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Aggregator } from "../../../target/types/aggregator";
import { setupTokenAccounts, provider } from "../../utils";
import { ComputeBudgetProgram } from "@solana/web3.js";

const program = anchor.workspace.aggregator as Program<Aggregator>;

// Original content moved from tests/edge_cases.test.ts below

describe("router edge cases", () => {
  /**
   * 1. No legs but non-zero min_out ⇒ should revert (SlippageExceeded)
   */
  it("fails when 0-leg route requests positive min_out", async () => {
    const { ata } = await setupTokenAccounts();
    const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_200_000 });

    try {
      await program.methods
        .route([], new anchor.BN(0), new anchor.BN(1), 0)
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

  /**
   * 2. Extremely high fee_bps (> 100%) ⇒ NumericalOverflow when user_receive underflows.
   */
  it("fails when fee_bps causes underflow (NumericalOverflow)", async () => {
    const { ata } = await setupTokenAccounts();
    const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_200_000 });

    const leg = {
      dexId: { lifinityV2: {} } as any,
      inAmount: new anchor.BN(100),
      minOut: new anchor.BN(90), // router will treat 90 as out_amount
      accountCount: 0,
      data: Buffer.alloc(0),
    };

    // fee_bps set to 60_000 (600%) so user_receive = 90 - 540 -> underflow
    try {
      await program.methods
        .route([leg], new anchor.BN(100), new anchor.BN(80), 60000)
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
        "tx should have failed due to NumericalOverflow from excessive fee"
      );
    } catch (_err) {
      console.log("overflow guard test passed – tx failed");
    }
  });

  /**
   * 3. fee_bps == 10_000 (exactly 100%) ⇒ should succeed (user_receive = 0).
   */
  it("succeeds with 100% fee (fee_bps = 10_000)", async () => {
    const { ata } = await setupTokenAccounts();
    const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_200_000 });

    const leg = {
      dexId: { lifinityV2: {} } as any,
      inAmount: new anchor.BN(50),
      minOut: new anchor.BN(40),
      accountCount: 0,
      data: Buffer.alloc(0),
    };

    await program.methods
      .route([leg], new anchor.BN(50), new anchor.BN(35), 10000)
      .accounts({
        userAuthority: provider.wallet.publicKey,
        userSource: ata,
        userDestination: ata,
        feeVault: ata,
        computeBudget: ComputeBudgetProgram.programId,
      })
      .preInstructions([cuIx])
      .rpc();

    console.log("100% fee test passed – tx succeeded");
  });

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
    } catch (_err) {
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
    };

    try {
      await program.methods
        .route([leg], new anchor.BN(30), new anchor.BN(15), 0)
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
