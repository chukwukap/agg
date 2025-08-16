import { orderMints } from "@orca-so/whirlpools";
import { AccountMeta, AccountRole, Address, address } from "@solana/kit";
import "dotenv/config";
import {
  AGGREGATOR_PROGRAM_ADDRESS,
  getRouteInstructionDataEncoder,
  RouteInput,
  RouteInstruction,
  RouteInstructionDataArgs,
} from "../clients/generated";
import {
  getAccountMetaFactory,
  ResolvedAccount,
} from "../clients/generated/shared";

export const stringify = (obj: any) => {
  const bigIntReplacer = (key: string, value: any) =>
    typeof value === "bigint" ? value.toString() : value;
  return JSON.stringify(obj, bigIntReplacer, 2);
};

// export const WHIRLPOOL_PROGRAM_ID = address(
//   "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"
// );

export const LIFINITY_PROGRAM_ID = address(
  "2wT8Yq49kHgDzXuPxZSaeLaH1qbmGXtEyPy64bL7aD3c"
);

// this tokens and pools are on solana devnet

export const [OrcaTestTokenA, OrcaTestTokenB] = orderMints(
  address("8PCG6MYJpM6xbVjAYgWF23XLjhpzGHTmFrcNReeQ7yeR"),
  address("HbCVgB4Pi4dc3MNp5j1PCKtDmP9ZgJukgBUSPKQAVXoq")
);

// splash pool
export const OrcaTestPoolAddress = address(
  "Ee4SDoT153bMnbAU6YRxbJucZ1vaGLE9ajXhhAEEPYS1"
);

export const ANCHOR_PROVIDER_URL =
  process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";

export function getRouteInstruction<
  TAccountUserAuthority extends string,
  TAccountUserSource extends string,
  TAccountUserDestination extends string,
  TAccountFeeVault extends string,
  TAccountConfig extends string,
  TAccountTokenProgram extends string,
  TProgramAddress extends Address = typeof AGGREGATOR_PROGRAM_ADDRESS,
  TRemainingAccounts extends readonly AccountMeta<string>[] = []
>(
  input: RouteInput<
    TAccountUserAuthority,
    TAccountUserSource,
    TAccountUserDestination,
    TAccountFeeVault,
    TAccountConfig,
    TAccountTokenProgram
  >,
  remainingAccounts: TRemainingAccounts,
  config?: { programAddress?: TProgramAddress }
): RouteInstruction<
  TProgramAddress,
  TAccountUserAuthority,
  TAccountUserSource,
  TAccountUserDestination,
  TAccountFeeVault,
  TAccountConfig,
  TAccountTokenProgram,
  TRemainingAccounts
> {
  // Program address.
  const programAddress = config?.programAddress ?? AGGREGATOR_PROGRAM_ADDRESS;

  // Original accounts.
  const originalAccounts = {
    userAuthority: { value: input.userAuthority ?? null, isWritable: false },
    userSource: { value: input.userSource ?? null, isWritable: true },
    userDestination: {
      value: input.userDestination ?? null,
      isWritable: true,
    },
    feeVault: { value: input.feeVault ?? null, isWritable: true },
    config: { value: input.config ?? null, isWritable: false },
    tokenProgram: { value: input.tokenProgram ?? null, isWritable: false },
  };
  const accounts = originalAccounts as Record<
    keyof typeof originalAccounts,
    ResolvedAccount
  >;

  // Original args.
  const args = { ...input };

  // Resolve default values.
  if (!accounts.tokenProgram.value) {
    accounts.tokenProgram.value =
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address<"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA">;
  }

  const getAccountMeta = getAccountMetaFactory(programAddress, "programId");
  const instruction = {
    accounts: [
      getAccountMeta(accounts.userAuthority),
      getAccountMeta(accounts.userSource),
      getAccountMeta(accounts.userDestination),
      getAccountMeta(accounts.feeVault),
      getAccountMeta(accounts.config),
      getAccountMeta(accounts.tokenProgram),
      ...remainingAccounts,
    ],
    programAddress,
    data: getRouteInstructionDataEncoder().encode(
      args as RouteInstructionDataArgs
    ),
  } as RouteInstruction<
    TProgramAddress,
    TAccountUserAuthority,
    TAccountUserSource,
    TAccountUserDestination,
    TAccountFeeVault,
    TAccountConfig,
    TAccountTokenProgram,
    TRemainingAccounts
  >;
  console.log(
    "instruction inside getRouteInstruction",
    JSON.stringify(instruction)
  );
  return instruction;
}
