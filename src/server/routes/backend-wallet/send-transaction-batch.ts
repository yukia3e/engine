import { Type, type Static } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import { StatusCodes } from "http-status-codes";
import type { Address, Hex } from "thirdweb";
import { insertTransaction } from "../../../shared/utils/transaction/insert-transaction";
import { AddressSchema } from "../../schemas/address";
import { standardResponseSchema } from "../../schemas/shared-api-schemas";
import { txOverridesWithValueSchema } from "../../schemas/tx-overrides";
import {
  walletChainParamSchema,
  walletHeaderSchema,
} from "../../schemas/wallet";
import { getChainIdFromChain } from "../../utils/chain";
import { parseTransactionOverrides } from "../../utils/transaction-overrides";

const requestBodySchema = Type.Array(
  Type.Object({
    toAddress: Type.Optional(AddressSchema),
    data: Type.String({
      examples: ["0x..."],
    }),
    value: Type.String({
      examples: ["10000000"],
    }),
    ...txOverridesWithValueSchema.properties,
  }),
);

const responseBodySchema = Type.Object({
  result: Type.Object({
    queueIds: Type.Array(Type.String()),
  }),
});

export async function sendTransactionBatch(fastify: FastifyInstance) {
  fastify.route<{
    Params: Static<typeof walletChainParamSchema>;
    Body: Static<typeof requestBodySchema>;
    Reply: Static<typeof responseBodySchema>;
  }>({
    method: "POST",
    url: "/backend-wallet/:chain/send-transaction-batch",
    schema: {
      summary: "Send a batch of raw transactions",
      description:
        "Send a batch of raw transactions with transaction parameters",
      tags: ["Backend Wallet"],
      operationId: "sendTransactionBatch",
      params: walletChainParamSchema,
      body: requestBodySchema,
      headers: walletHeaderSchema,
      response: {
        ...standardResponseSchema,
        [StatusCodes.OK]: responseBodySchema,
      },
    },
    handler: async (request, reply) => {
      const { chain } = request.params;
      const {
        "x-backend-wallet-address": fromAddress,
        "x-transaction-mode": transactionMode,
      } = request.headers as Static<typeof walletHeaderSchema>;
      const chainId = await getChainIdFromChain(chain);

      const transactionRequests = request.body;

      const queueIds: string[] = [];
      for (const transactionRequest of transactionRequests) {
        const { toAddress, data, value, txOverrides } = transactionRequest;

        const queueId = await insertTransaction({
          insertedTransaction: {
            isUserOp: false,
            chainId,
            transactionMode,
            from: fromAddress as Address,
            to: toAddress as Address | undefined,
            data: data as Hex,
            value: BigInt(value),
            ...parseTransactionOverrides(txOverrides),
          },
        });
        queueIds.push(queueId);
      }

      reply.status(StatusCodes.OK).send({
        result: {
          queueIds,
        },
      });
    },
  });
}
