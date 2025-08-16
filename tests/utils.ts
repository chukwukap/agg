import { orderMints } from "@orca-so/whirlpools";
import { address } from "@solana/kit";
import "dotenv/config";

export const stringify = (obj: any) => {
  const bigIntReplacer = (key: string, value: any) =>
    typeof value === "bigint" ? value.toString() : value;
  return JSON.stringify(obj, bigIntReplacer, 2);
};

export const WHIRLPOOL_PROGRAM_ID = address(
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"
);

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
