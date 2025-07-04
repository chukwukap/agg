import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Aggregator } from "../../../target/types/aggregator";
import { setupTokenAccounts, provider } from "../../utils";
import { ComputeBudgetProgram } from "@solana/web3.js";

const program = anchor.workspace.aggregator as Program<Aggregator>;

describe("router::route - happy-path (no legs)", () => {
  it("routes zero legs and returns ok", async () => {
    const { ata } = await setupTokenAccounts();

    // Fee vault can be the same ATA for this dummy test
    const feeVault = ata;

    // Build compute budget ix (as SDK would)
    const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });

    await program.methods
      .route([], new anchor.BN(0), new anchor.BN(0), 0)
      .accounts({
        userAuthority: provider.wallet.publicKey,
        userSource: ata,
        userDestination: ata,
        feeVault,
        computeBudget: ComputeBudgetProgram.programId,
      })
      .preInstructions([cuIx])
      .rpc();
  });
});

describe("router::route - two-leg path", () => {
  it("routes two dummy legs", async () => {
    const { ata } = await setupTokenAccounts();
    const feeVault = ata;
    const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });

    const legStruct = (variant: "lifinityV2" | "orcaWhirlpool") => ({
      dexId: { [variant]: {} } as any,
      inAmount: new anchor.BN(100),
      minOut: new anchor.BN(90),
      accountCount: 0,
      data: Buffer.alloc(0),
    });

    await program.methods
      .route(
        [legStruct("lifinityV2"), legStruct("orcaWhirlpool")],
        new anchor.BN(100),
        new anchor.BN(80),
        0
      )
      .accounts({
        userAuthority: provider.wallet.publicKey,
        userSource: ata,
        userDestination: ata,
        feeVault,
        computeBudget: ComputeBudgetProgram.programId,
      })
      .preInstructions([cuIx])
      .rpc();
  });
});
