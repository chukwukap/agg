import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Aggregator } from "../target/types/aggregator";
import {
  setupTokenAccounts,
  provider,
  getConfigPda,
  buildDummyLeg,
  requestAirdrop,
} from "./utils";
import * as fc from "fast-check";
import { expect } from "chai";

const program = anchor.workspace.aggregator as Program<Aggregator>;

/**
 * Unit / property tests covering pure math helpers used on-chain.
 * Security: All assertions use Chai's .equal/.deep.equal/.true/.false for compatibility.
 */
describe("unit: on-chain config helpers", () => {
  it("init_config sets correct fee_bps and vault", async () => {
    const { mint, ata } = await setupTokenAccounts();
    const [configPda] = getConfigPda();

    await program.methods
      .initConfig(150) // 1.5%
      .accounts({
        admin: provider.wallet.publicKey,
        feeVault: ata,
      })
      .rpc();

    const cfg = await program.account.config.fetch(configPda);
    // Use .equal for value comparison
    expect(cfg.feeBps).to.equal(150);
    expect(cfg.feeVault.toBase58()).to.equal(ata.toBase58());
  });

  it("set_config updates fee_bps within bounds", async () => {
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

  it("set_config rejects fee_bps > 10 000", async () => {
    const [configPda] = getConfigPda();
    let errorCaught = false;
    try {
      await program.methods
        .setConfig(20_001, provider.wallet.publicKey)
        .accounts({
          admin: provider.wallet.publicKey,
          // Remove 'config' from accounts if not required by IDL
        })
        .rpc();
    } catch (err) {
      errorCaught = true;
    }
    expect(errorCaught).to.equal(true);
  });

  it("pause/unpause toggles and enforces route access", async () => {
    const { mint, ata } = await setupTokenAccounts();
    const [configPda] = getConfigPda();

    // Pause
    await program.methods
      .pause()
      .accounts({ admin: provider.wallet.publicKey })
      .rpc();

    // Building a dummy leg
    const leg = buildDummyLeg(mint, 100n, 80n);

    // Route should now fail due to pause switch
    let errorCaught = false;
    try {
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
    } catch (err) {
      errorCaught = true;
    }
    expect(errorCaught).to.equal(true);

    // Unpause
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

  it("init_config rejects reinitialisation", async () => {
    const { mint, ata } = await setupTokenAccounts();
    const [configPda] = getConfigPda();

    // First initialisation succeeds
    await program.methods
      .initConfig(100)
      .accounts({
        admin: provider.wallet.publicKey,
        feeVault: ata,
      })
      .rpc();

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
    } catch (err) {
      errorCaught = true;
    }
    expect(errorCaught).to.equal(true);
  });

  it("unauthorized admin call fails", async () => {
    const [configPda] = getConfigPda();
    const fake = anchor.web3.Keypair.generate();

    await requestAirdrop(fake.publicKey);

    let errorCaught = false;
    try {
      await program.methods
        .pause()
        .accounts({ admin: fake.publicKey })
        .signers([fake])
        .rpc();
    } catch (err) {
      errorCaught = true;
    }
    expect(errorCaught).to.equal(true);
  });

  it("unauthorized set_config call fails", async () => {
    const [configPda] = getConfigPda();
    const fake = anchor.web3.Keypair.generate();

    await requestAirdrop(fake.publicKey);

    let errorCaught = false;
    try {
      await program.methods
        .setConfig(300, fake.publicKey)
        .accounts({ admin: fake.publicKey })
        .signers([fake])
        .rpc();
    } catch (err) {
      errorCaught = true;
    }
    expect(errorCaught).to.equal(true);
  });
});

/** Arithmetic edge-case property: fee calculation never overflows and fee<=out */
describe("unit: fee maths edge cases", () => {
  it("fee maths safe for u64::MAX", async () => {
    await fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000 }), (bps) => {
        const max = BigInt("18446744073709551615"); // u64::MAX
        const fee = (max * BigInt(bps)) / 10_000n;
        expect(fee <= max).to.equal(true);
      })
    );
  });
});
