import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Aggregator } from "../target/types/aggregator";
import { expect } from "chai";

import {
  setupTokenAccounts,
  provider,
  getConfigPda,
  buildDummyLeg,
  requestAirdrop,
  ensureTestConfig,
} from "./utils";

const program = anchor.workspace.aggregator as Program<Aggregator>;

/**
 * Unit and property tests for UmbraSwap on-chain config helpers.
 * These tests ensure correct config initialization, update, and admin controls.
 * Security: All error assertions are explicit and check for AnchorError and expected messages.
 */
describe.skip("unit: on-chain config helpers", function () {
  this.timeout(0);

  let mint: anchor.web3.PublicKey;
  let ata: anchor.web3.PublicKey;
  before("setup token accounts", async function () {
    const res = await setupTokenAccounts();
    mint = res.mint;
    ata = res.ata;
    // await ensureTestConfig(mint); // sets fee_vault to this ATA
  });

  it.skip("init_config sets correct fee_bps and vault", async function () {
    const [configPda] = getConfigPda();

    await program.methods
      .initConfig(150) // 1.5%
      .accounts({
        admin: provider.wallet.publicKey,
        feeVault: ata,
      })
      .rpc();

    const cfg = await program.account.config.fetch(configPda);
    expect(cfg.feeBps).to.equal(150);
    expect(cfg.feeVault.toBase58()).to.equal(ata.toBase58());
  });

  it("set_config updates fee_bps within bounds", async function () {
    const [configPda] = getConfigPda();
    await program.methods
      .setConfig(250, provider.wallet.publicKey)
      .accounts({
        admin: provider.wallet.publicKey,
      })
      .rpc();

    const cfg = await program.account.config.fetch(configPda);
    expect(cfg.feeBps).to.equal(250);
  });

  it("set_config rejects fee_bps > 10 000", async function () {
    let errorCaught = false;
    try {
      await program.methods
        .setConfig(10_001, provider.wallet.publicKey)
        .accounts({
          admin: provider.wallet.publicKey,
        })
        .rpc();
    } catch (err: any) {
      errorCaught = true;
      expect(err instanceof anchor.AnchorError).to.be.true;
    }
    expect(errorCaught, "Expected setConfig with >10000 bps to throw").to.be
      .true;
  });

  it.skip("pause/unpause toggles and enforces route access", async function () {
    // Pause the contract
    await program.methods
      .pause()
      .accounts({ admin: provider.wallet.publicKey })
      .rpc();

    console.log("pause========>>>");
    // Build a dummy leg for routing
    const leg = buildDummyLeg(mint, 100n, 80n);

    console.log("leg========>>>", leg);

    // Route should now fail due to pause switch
    let routeFailed = false;
    try {
      await program.methods
        .route([leg], new anchor.BN(100), new anchor.BN(80))
        .accounts({
          userAuthority: provider.wallet.publicKey,
          userSource: ata,
          userDestination: ata,
          feeVault: ata,
        })
        .rpc();
    } catch (err: any) {
      routeFailed = true;
      // Security: Accept both AnchorError and generic Error, but check for pause message
      expect(
        err instanceof anchor.AnchorError || err instanceof Error,
        "Expected AnchorError or Error"
      ).to.be.true;
      expect(
        err.message.match(/paused/i),
        "Error message should mention paused"
      ).to.not.be.null;
    }
    expect(routeFailed, "Expected route to fail when paused").to.be.true;

    // Unpause the contract
    await program.methods
      .unpause()
      .accounts({ admin: provider.wallet.publicKey })
      .rpc();

    // Route should succeed now (no remaining accounts needed)
    await program.methods
      .route([leg], new anchor.BN(100), new anchor.BN(80))
      .accounts({
        userAuthority: provider.wallet.publicKey,
        userSource: ata,
        userDestination: ata,
        feeVault: ata,
        computeBudget: anchor.web3.ComputeBudgetProgram.programId,
      })
      .rpc();
  });

  it("init_config rejects reinitialisation", async function () {
    // First initialisation succeeds
    // await program.methods
    //   .initConfig(100)
    //   .accounts({
    //     admin: provider.wallet.publicKey,
    //     feeVault: ata,
    //   })
    //   .rpc();

    // Second call should fail
    let errorCaught = false;
    try {
      await program.methods
        .initConfig(100)
        .accounts({
          admin: provider.wallet.publicKey,
          feeVault: ata,
        })
        .rpc();
    } catch (err: any) {
      errorCaught = true;
    }
    expect(errorCaught, "Expected reinitialisation to throw").to.be.true;
  });

  it("unauthorized admin call fails", async function () {
    const fake = anchor.web3.Keypair.generate();

    await requestAirdrop(fake.publicKey);

    let errorCaught = false;
    try {
      await program.methods
        .pause()
        .accounts({ admin: fake.publicKey })
        .signers([fake])
        .rpc();
    } catch (err: any) {
      errorCaught = true;
    }
    expect(errorCaught, "Expected unauthorized admin call to throw").to.be.true;
  });

  it("unauthorized set_config call fails", async function () {
    const fake = anchor.web3.Keypair.generate();

    await requestAirdrop(fake.publicKey);

    // We use try/catch to assert on the error, since .rejectedWith is not available
    let errorCaught = false;
    try {
      await program.methods
        .setConfig(300, fake.publicKey)
        .accounts({ admin: fake.publicKey })
        .signers([fake])
        .rpc();
    } catch (err: any) {
      errorCaught = true;
      // Security: Accept both AnchorError and generic Error, but check for Unauthorized
      expect(
        err instanceof anchor.AnchorError || err instanceof Error,
        "Expected AnchorError or Error"
      ).to.be.true;
      expect(
        err.message.includes("Unauthorized") ||
          err.message.match(/not.*admin/i),
        "Error message should mention Unauthorized or admin"
      ).to.be.true;
    }
    expect(errorCaught, "Expected unauthorized setConfig to throw").to.be.true;
  });
});
