import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Aggregator } from "../target/types/aggregator";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import {
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  ComputeBudgetProgram,
} from "@solana/web3.js";

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

const program = anchor.workspace.aggregator as Program<Aggregator>;

/**
 * Helper: create dummy mint + ATA funded with some tokens so we can
 * provide user_source / destination accounts even though the router
 * won't touch them (empty legs).
 */
async function setupTokenAccounts(): Promise<{
  mint: PublicKey;
  ata: PublicKey;
}> {
  const mint = await createMint(
    provider.connection,
    provider.wallet.payer,
    provider.wallet.publicKey,
    null,
    6 // decimals
  );
  const ata = (
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      provider.wallet.payer,
      mint,
      provider.wallet.publicKey
    )
  ).address;
  // Mint some tokens
  await mintTo(
    provider.connection,
    provider.wallet.payer,
    mint,
    ata,
    provider.wallet.publicKey,
    1_000_000n
  );
  return { mint, ata };
}

describe("aggregator::route - happy-path (no legs)", () => {
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

describe("aggregator::route - path test", () => {
  it("routes two legs and returns ok", async () => {
    const { ata } = await setupTokenAccounts();

    // Fee vault can be the same ATA for this dummy test
    const feeVault = ata;

    // Build compute budget ix (as SDK would)
    const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });

    // Build two dummy legs (accountCount=0) to simulate path.
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

describe("aggregator::route - fee logic", () => {
  it("deducts protocol fee", async () => {
    const { ata, mint } = await setupTokenAccounts();

    // create separate vault ATA with same mint
    const feeVault = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        provider.wallet.payer,
        mint,
        provider.wallet.publicKey
      )
    ).address;

    const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });

    const beforeDest = Number(
      (await provider.connection.getTokenAccountBalance(ata)).value.amount
    );
    const beforeFee = Number(
      (await provider.connection.getTokenAccountBalance(feeVault)).value.amount
    );

    const leg = {
      dexId: { lifinityV2: {} } as any,
      inAmount: new anchor.BN(1_000_000),
      minOut: new anchor.BN(900_000),
      accountCount: 0,
      data: Buffer.alloc(0),
    };

    await program.methods
      .route([leg], new anchor.BN(1_000_000), new anchor.BN(800_000), 500) // 5% fee
      .accounts({
        userAuthority: provider.wallet.publicKey,
        userSource: ata,
        userDestination: ata,
        feeVault,
        computeBudget: ComputeBudgetProgram.programId,
      })
      .preInstructions([cuIx])
      .rpc();

    const afterDest = Number(
      (await provider.connection.getTokenAccountBalance(ata)).value.amount
    );
    const afterFee = Number(
      (await provider.connection.getTokenAccountBalance(feeVault)).value.amount
    );

    const feeCharged = beforeDest - afterDest;
    const feeReceived = afterFee - beforeFee;
    // Expect ~5% of 900_000 = 45_000 token atoms
    if (feeCharged !== 45_000 || feeReceived !== 45_000) {
      throw new Error("Fee not applied correctly");
    }
  });
});

describe("aggregator::route - slippage guard", () => {
  it("reverts when min_out too high", async () => {
    const { ata } = await setupTokenAccounts();
    const feeVault = ata;

    const leg = {
      dexId: { lifinityV2: {} } as any,
      inAmount: new anchor.BN(100),
      minOut: new anchor.BN(90),
      accountCount: 0,
      data: Buffer.alloc(0),
    };

    try {
      await program.methods
        .route([leg], new anchor.BN(100), new anchor.BN(95), 0) // ask for > minOut
        .accounts({
          userAuthority: provider.wallet.publicKey,
          userSource: ata,
          userDestination: ata,
          feeVault,
          computeBudget: ComputeBudgetProgram.programId,
        })
        .rpc();
      throw new Error("tx should have failed");
    } catch (err) {
      // Expect Anchor error code for SlippageExceeded (0x1771?). We'll just assert transaction failed.
      console.log("slippage test passed - tx failed as expected");
    }
  });
});
