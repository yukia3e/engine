import { Type } from "@sinclair/typebox";

/**
 * An EVM address schema. Override the description like this:
 *
 * ```typescript
 *   to: {
 *      ...AddressSchema,
 *      description: "The recipient wallet address.",
 *    },
 * ```
 */
export const AddressSchema = Type.RegExp(/^0x[a-fA-F0-9]{40}$/, {
  description: "A contract or wallet address",
  examples: ["0x000000000000000000000000000000000000dead"],
});

export const TransactionHashSchema = Type.RegExp(/^0x[a-fA-F0-9]{64}$/, {
  description: "A transaction hash",
  examples: [
    "0x1f31b57601a6f90312fd5e57a2924bc8333477de579ee37b197a0681ab438431",
  ],
});

export const HexSchema = Type.RegExp(/^0x[a-fA-F0-9]*$/, {
  description: "A valid hex string",
  examples: ["0x68656c6c6f20776f726c64"],
});
