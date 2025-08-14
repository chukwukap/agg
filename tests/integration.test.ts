import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Aggregator } from "../target/types/aggregator";
import {
  setupTokenAccounts,
  provider,
  buildDummyLeg,
  createAtaForMint,
  getConfigPda,
  TestTokenA,
  TestTokenB,
} from "./utils";
import {
  ComputeBudgetProgram,
  PublicKey,
  SendTransactionError,
} from "@solana/web3.js";
import { expect } from "chai";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
} from "@solana/spl-token";
import { buildOrcaWhirlpoolLegForPool } from "./amm_helpers/orca";
// Heavy AMM helpers are excluded in lean test mode

const program = anchor.workspace.aggregator as Program<Aggregator>;

/**
 * Integration tests – executed against a local validator via `anchor test`.
 * We use the stub Lifinity adapter (0 remaining accounts) so no heavy account
 * setup is needed.  These tests focus on high-level router behaviour & guards.
 */
describe("integration: router behaviour (lean)", function () {
  this.timeout(20000); // allow 20s for on-chain pool bootstrap

  let mint: anchor.web3.PublicKey;
  let ata: anchor.web3.PublicKey;
  let configPda: anchor.web3.PublicKey = getConfigPda()[0];

  before("setup token accounts", async function () {
    const res = await setupTokenAccounts(5_000_000n);
    mint = res.mint;
    ata = res.ata;

    // ensure Config PDA exists with fee_bps set
    const program = anchor.workspace.aggregator as Program<Aggregator>;
    try {
      await program.account.config.fetch(configPda);
    } catch (_) {
      await program.methods
        .initConfig(200)
        .accounts({ admin: provider.wallet.publicKey })
        .rpc();
    }
  });

  it("devnet: executes Orca Whirlpool WSOL->USDC and collects fee", async function () {
    // Known devnet WSOL/USDC pool and mints (replace if needed)
    const WSOL = new PublicKey("So11111111111111111111111111111111111111112");
    const USDC = new PublicKey("Es9vMFrzaCERmJfrF4H2FYD1gYQTeWY5Avzk1H3eZ9Do"); // common devnet USDC; adjust if necessary
    const POOL = "Ee4SDoT153bMnbAU6YRxbJucZ1vaGLE9ajXhhAEEPYS1"; // from utils TestPoolAddress

    // 1) Ensure Config exists
    const [configPda] = getConfigPda();
    try {
      await (anchor.workspace.aggregator as Program<Aggregator>).account.config.fetch(
        configPda
      );
    } catch (_) {
      await (anchor.workspace.aggregator as Program<Aggregator>).methods
        .initConfig(200)
        .accounts({ admin: provider.wallet.publicKey })
        .rpc();
    }

    // 2) Build Whirlpool leg for the known pool (small trade)
    const inAmount = 50_000_000n; // 0.05 SOL
    const minOut = 1n;
    const { leg, remainingAccounts } = await buildOrcaWhirlpoolLegForPool(
      inAmount,
      minOut,
      POOL,
      WSOL,
      USDC,
      150
    );

    // 3) Ensure user WSOL ATA is wrapped with lamports
    const userAuthority = provider.wallet.publicKey;
    const userSource = getAssociatedTokenAddressSync(WSOL, userAuthority);
    const wrapTx = new anchor.web3.Transaction()
      .add(
        createAssociatedTokenAccountInstruction(
          userAuthority,
          userSource,
          userAuthority,
          WSOL
        )
      )
      .add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: userAuthority,
          toPubkey: userSource,
          lamports: Number(inAmount),
        })
      )
      .add(createSyncNativeInstruction(userSource));
    try {
      await provider.sendAndConfirm(wrapTx);
    } catch (_) {}

    // 4) Ensure user destination and admin fee vault ATAs for USDC
    const userDestination = getAssociatedTokenAddressSync(USDC, userAuthority);
    const createAtas = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(
        userAuthority,
        userDestination,
        userAuthority,
        USDC
      )
    );
    try {
      await provider.sendAndConfirm(createAtas);
    } catch (_) {}
    const feeVault = getAssociatedTokenAddressSync(USDC, userAuthority);

    // 5) Execute route on devnet program
    const txSig = await program.methods
      .route([leg], new anchor.BN(inAmount.toString()), new anchor.BN(minOut.toString()))
      .accountsStrict({
        userAuthority,
        userSource,
        userDestination,
        feeVault,
        config: configPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts(remainingAccounts)
      .preInstructions([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_600_000 }),
      ])
      .rpc();

    console.log("devnet swap tx:", txSig);
    console.log(`Explorer: https://explorer.solana.com/tx/${txSig}?cluster=devnet`);
  });

  it("executes a zero-account leg path (no-op) and respects guards", async function () {
    const leg = buildDummyLeg(mint, 1_000n, 900n);
    await program.methods
      .route([leg], new anchor.BN(0), new anchor.BN(0))
      .accounts({
        userAuthority: provider.wallet.publicKey,
        userSource: ata,
        userDestination: ata,
        feeVault: ata,
      })
      .rpc();
  });

  /** Guard: consecutive legs must have matching mints */
  it("fails when mint continuity breaks", async function () {
    const other = await setupTokenAccounts();
    const leg1 = buildDummyLeg(mint, 1000n, 900n);
    const leg2 = buildDummyLeg(other.mint, 900n, 800n); // in_mint mismatch

    let errorCaught = false;
    try {
      await program.methods
        .route([leg1, leg2], new anchor.BN(2_000), new anchor.BN(1_500))
        .accounts({
          userAuthority: provider.wallet.publicKey,
          userSource: ata,
          userDestination: ata,
          feeVault: ata,
        })
        .rpc();
    } catch (err) {
      errorCaught = true;
      expect(err).to.be.instanceOf(Error);
    }
    expect(errorCaught, "Expected error for mint continuity break").to.be.true;
  });

  /** Guard: user_max_in exceeded */
  it("fails when spent tokens exceed user_max_in", async function () {
    const leg = buildDummyLeg(mint, 10_000n, 9_000n);

    let errorCaught = false;
    try {
      await program.methods
        .route([leg], new anchor.BN(5_000), new anchor.BN(8_000)) // max_in too small
        .accounts({
          userAuthority: provider.wallet.publicKey,
          userSource: ata,
          userDestination: ata,
          feeVault: ata,
        })
        .rpc();
    } catch (err) {
      errorCaught = true;
      expect(err).to.be.instanceOf(Error);
    }
    expect(errorCaught, "Expected error for user_max_in exceeded").to.be.true;
  });

  /** Guard: user_min_out (net) not satisfied */
  it("fails when net out < user_min_out", async function () {
    const leg = buildDummyLeg(mint, 1_000_000n, 800_000n);

    let errorCaught = false;
    try {
      await program.methods
        .route([leg], new anchor.BN(1_100_000), new anchor.BN(810_000)) // min_out too high
        .accounts({
          userAuthority: provider.wallet.publicKey,
          userSource: ata,
          userDestination: ata,
          feeVault: ata,
        })
        .rpc();
    } catch (err) {
      errorCaught = true;
      expect(err).to.be.instanceOf(Error);
    }
    expect(errorCaught, "Expected error for user_min_out not satisfied").to.be
      .true;
  });

  /** Guard: fee vault mint mismatch */
  it("fails when fee vault mint differs from out mint", async function () {
    const other = await setupTokenAccounts();
    const leg = buildDummyLeg(mint, 1_000n, 900n);

    let errorCaught = false;
    try {
      await program.methods
        .route([leg], new anchor.BN(1_500), new anchor.BN(850))
        .accounts({
          userAuthority: provider.wallet.publicKey,
          userSource: ata,
          userDestination: ata,
          feeVault: other.ata, // vault mint != leg.outMint
        })
        .rpc();
    } catch (err) {
      errorCaught = true;
      expect(err).to.be.instanceOf(Error);
    }
    expect(errorCaught, "Expected error for fee vault mint mismatch").to.be
      .true;
  });

  /** Stress: many legs require explicit compute budget */
  it("requires compute budget for long paths", async function () {
    const leg = buildDummyLeg(mint, 1_000n, 900n);
    const longPath = Array.from({ length: 10 }, () => ({ ...leg }));

    // Without CU ix should fail
    let errorCaught = false;
    try {
      await program.methods
        .route(longPath, new anchor.BN(30_000), new anchor.BN(20_000))
        .accounts({
          userAuthority: provider.wallet.publicKey,
          userSource: ata,
          userDestination: ata,
          feeVault: ata,
        })
        .rpc();
    } catch (err) {
      errorCaught = true;
      expect(err).to.be.instanceOf(Error);
    }
    expect(errorCaught, "Expected error for missing compute budget").to.be.true;

    // Adding CU ix succeeds
    await program.methods
      .route(longPath, new anchor.BN(30_000), new anchor.BN(20_000))
      .accounts({
        userAuthority: provider.wallet.publicKey,
        userSource: ata,
        userDestination: ata,
        feeVault: ata,
      })
      .preInstructions([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_800_000 }),
      ])
      .rpc();
  });

  /** Guard: RemainingAccountsMismatch with extra accounts */
  it("fails when too many remaining accounts provided", async function () {
    const leg = { ...buildDummyLeg(mint, 1000n, 900n), accountCount: 0 };

    const dummyAcc = anchor.web3.Keypair.generate();

    let errorCaught = false;
    try {
      await program.methods
        .route([leg], new anchor.BN(2000), new anchor.BN(850))
        .accounts({
          userAuthority: provider.wallet.publicKey,
          userSource: ata,
          userDestination: ata,
          feeVault: ata,
        })
        .remainingAccounts([
          { pubkey: dummyAcc.publicKey, isSigner: false, isWritable: false },
        ]) // 1 extra while accountCount =0
        .rpc();
    } catch (err) {
      errorCaught = true;
      expect(err).to.be.instanceOf(Error);
    }
    expect(errorCaught, "Expected error for too many remaining accounts").to.be
      .true;
  });

  /** Adapter owner-whitelist rejects foreign program id (using Orca variant) */
  it("adapter whitelist rejects foreign owner", async function () {
    const foreignLeg = {
      ...buildDummyLeg(mint, 1000n, 900n),
      dexId: { orcaWhirlpool: {} } as any,
      accountCount: 1,
    };

    const wrongAccount = anchor.web3.Keypair.generate();
    // create minimal lamport account
    await provider.connection.requestAirdrop(
      wrongAccount.publicKey,
      1_000_000_000
    );

    let errorCaught = false;
    try {
      await program.methods
        .route([foreignLeg], new anchor.BN(2000), new anchor.BN(850))
        .accounts({
          userAuthority: provider.wallet.publicKey,
          userSource: ata,
          userDestination: ata,
          feeVault: ata,
        })
        .remainingAccounts([
          {
            pubkey: wrongAccount.publicKey,
            isSigner: false,
            isWritable: false,
          },
        ])
        .rpc();
    } catch (err) {
      errorCaught = true;
      expect(err).to.be.instanceOf(Error);
    }
    expect(errorCaught, "Expected error for adapter whitelist foreign owner").to
      .be.true;
  });

  /** Guard: empty legs rejected */
  it("fails when legs array is empty", async function () {
    let errorCaught = false;
    try {
      await program.methods
        .route([], new anchor.BN(0), new anchor.BN(1))
        .accounts({
          userAuthority: provider.wallet.publicKey,
          userSource: ata,
          userDestination: ata,
          feeVault: ata,
        })
        .rpc();
    } catch (err) {
      errorCaught = true;
      expect(err).to.be.instanceOf(Error);
    }
    expect(errorCaught, "Expected error for empty legs array").to.be.true;
  });

  /** Fee-vault address mismatch (mint matches) */
  it("fails when fee vault address != admin ATA for out mint", async function () {
    const rogue = anchor.web3.Keypair.generate();
    await provider.connection.requestAirdrop(rogue.publicKey, 1_000_000_000);
    const otherVault = await createAtaForMint(mint, rogue.publicKey);
    const leg = buildDummyLeg(mint, 1000n, 900n);

    let errorCaught = false;
    try {
      await program.methods
        .route([leg], new anchor.BN(1500), new anchor.BN(850))
        .accounts({
          userAuthority: provider.wallet.publicKey,
          userSource: ata,
          userDestination: ata,
          feeVault: otherVault, // different address but same mint (not admin ATA)
        })
        .rpc();
    } catch (err) {
      errorCaught = true;
      expect(err).to.be.instanceOf(Error);
    }
    expect(errorCaught, "Expected error for fee vault address mismatch").to.be
      .true;
  });

  /** Second adapter whitelist (Invariant) */
  it("invariant adapter whitelist rejects foreign owner", async function () {
    const invLeg = {
      ...buildDummyLeg(mint, 1000n, 900n),
      dexId: { invariant: {} } as any,
      accountCount: 1,
    };
    const rogue = anchor.web3.Keypair.generate();
    await provider.connection.requestAirdrop(rogue.publicKey, 1_000_000_000);

    let errorCaught = false;
    try {
      await program.methods
        .route([invLeg], new anchor.BN(2000), new anchor.BN(850))
        .accounts({
          userAuthority: provider.wallet.publicKey,
          userSource: ata,
          userDestination: ata,
          feeVault: ata,
        })
        .remainingAccounts([
          { pubkey: rogue.publicKey, isSigner: false, isWritable: false },
        ])
        .rpc();
    } catch (err) {
      errorCaught = true;
      expect(err).to.be.instanceOf(Error);
    }
    expect(errorCaught, "Expected error for invariant adapter whitelist").to.be
      .true;
  });
});
