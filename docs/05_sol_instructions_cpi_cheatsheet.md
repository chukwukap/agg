# Solana instructions and CPI – quick reference

## Instruction anatomy

- **program_id**: target program
- **accounts**: ordered `AccountMeta[]` (pubkey, is_signer, is_writable)
- **data**: opaque bytes. With Anchor = 8-byte discriminator + Borsh-encoded args

## Execution

- Client builds a transaction (one or more instructions). Runtime locks accounts, loads program, passes `accounts` and `data` to entrypoint.
- Programs mutate only writable accounts and only if they own them (or via CPI to their owners).

## CPI (cross-program invocation)

- A program can invoke another by constructing an `Instruction` and calling `invoke`/`invoke_signed`.
- You can only pass accounts you already have. PDAs “sign” with `invoke_signed` seeds.

## Anchor specifics

- `discriminator = sha256("global:" + ix_name)[..8]`
- Args serialized with Borsh in declaration order
- `#[derive(Accounts)]` enforces account order and constraints
- `ctx.remaining_accounts` carries flexible passthrough accounts

## Common pitfalls

- Wrong account order or flags (signer/writable)
- Incorrect program owner for accounts (e.g., token accounts must be SPL-Token)
- Missing `invoke_signed` when a PDA must authorize
- Mis-serialized data (wrong discriminator/endianness/arg order)

## Example: Whirlpool classic `swap` args

```
amount: u64
otherAmountThreshold: u64
sqrtPriceLimit: u128
amountSpecifiedIsInput: bool
aToB: bool
```

## Example: building CPI in Anchor (from adapter)

```rust
let ix = Instruction { program_id, accounts, data };
program::invoke(&ix, account_infos)?;
```
