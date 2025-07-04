import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Aggregator } from "../../../target/types/aggregator";
import { setupTokenAccounts, provider } from "../../utils";
import { ComputeBudgetProgram } from "@solana/web3.js";

const program = anchor.workspace.aggregator as Program<Aggregator>;

describe("router::route - two-leg path", () => {
  it("routes two dummy legs", async () => {
    const { ata, mint } = await setupTokenAccounts();
    const feeVault = ata;
    const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });

    const legStruct = (
      variant: "lifinityV2" | "orcaWhirlpool",
      inMint: anchor.web3.PublicKey,
      outMint: anchor.web3.PublicKey
    ) => ({
      dexId: { [variant]: {} } as any,
      inAmount: new anchor.BN(100),
      minOut: new anchor.BN(90),
      accountCount: 0,
      data: Buffer.alloc(0),
      inMint,
      outMint,
    });

    await program.methods
      .route(
        [
          legStruct("lifinityV2", mint, mint),
          legStruct("orcaWhirlpool", mint, mint),
        ] as any,
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
