import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Aggregator } from "../../../target/types/aggregator";
import { setupTokenAccounts, provider } from "../../utils";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { ComputeBudgetProgram } from "@solana/web3.js";

const program = anchor.workspace.aggregator as Program<Aggregator>;

describe("integration – protocol fee is transferred", () => {
  it("transfers the correct fee to the vault", async () => {
    // 1. Create a fresh mint and three ATAs: source, destination, feeVault
    const { mint, ata: sourceAta } = await setupTokenAccounts();

    // destination ATA distinct from source
    const destinationAta = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        provider.wallet.payer,
        mint,
        provider.wallet.publicKey // owner
      )
    ).address;

    // fee vault (owned by same user for test simplicity)
    const feeVaultAta = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        provider.wallet.payer,
        mint,
        provider.wallet.publicKey
      )
    ).address;

    // Prefund destination with 1_000 tokens (6 decimals)
    await mintTo(
      provider.connection,
      provider.wallet.payer,
      mint,
      destinationAta,
      provider.wallet.publicKey,
      1_000_000n // 1,000 tokens * 10^6
    );

    // Initial balance snapshot
    const destBefore = (await getAccount(provider.connection, destinationAta))
      .amount;
    const vaultBefore = (await getAccount(provider.connection, feeVaultAta))
      .amount;

    // Build leg that returns out_amount = 500_000 (0.5k tokens) so fee is calculable.
    const leg = {
      dexId: { lifinityV2: {} } as any,
      inAmount: new anchor.BN(800_000), // spent
      minOut: new anchor.BN(500_000),
      accountCount: 0,
      data: Buffer.alloc(0),
      inMint: mint,
      outMint: mint,
    };

    const FEE_BPS = 200; // 2% – matches on-chain config in tests

    const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });

    await program.methods
      .route([leg], new anchor.BN(900_000), new anchor.BN(400_000))
      .accounts({
        userAuthority: provider.wallet.publicKey,
        userSource: sourceAta,
        userDestination: destinationAta,
        feeVault: feeVaultAta,
        computeBudget: ComputeBudgetProgram.programId,
      })
      .preInstructions([cuIx])
      .rpc();

    // After tx balances
    const destAfter = (await getAccount(provider.connection, destinationAta))
      .amount;
    const vaultAfter = (await getAccount(provider.connection, feeVaultAta))
      .amount;

    const expectedFee = (BigInt(500_000) * BigInt(FEE_BPS)) / 10_000n; // 10,000 bps = 100%

    if (vaultAfter - vaultBefore !== expectedFee) {
      throw new Error(
        `Fee vault delta mismatch: expected ${expectedFee}, got ${
          vaultAfter - vaultBefore
        }`
      );
    }

    if (destBefore - destAfter !== expectedFee) {
      throw new Error(
        "Destination token account did not decrease by fee amount"
      );
    }
  });
});
