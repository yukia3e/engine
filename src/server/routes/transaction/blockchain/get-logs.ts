import { type Static, Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import { StatusCodes } from "http-status-codes";
import type { AbiEvent } from "ox";
import superjson from "superjson";
import {
  type Hex,
  eth_getTransactionReceipt,
  getContract,
  getRpcClient,
  parseEventLogs,
  prepareEvent,
} from "thirdweb";
import { resolveContractAbi } from "thirdweb/contract";
import type { TransactionReceipt } from "thirdweb/transaction";
import { TransactionDB } from "../../../../shared/db/transactions/db";
import { getChain } from "../../../../shared/utils/chain";
import { thirdwebClient } from "../../../../shared/utils/sdk";
import { createCustomError } from "../../../middleware/error";
import { AddressSchema, TransactionHashSchema } from "../../../schemas/address";
import { chainIdOrSlugSchema } from "../../../schemas/chain";
import { standardResponseSchema } from "../../../schemas/shared-api-schemas";
import { getChainIdFromChain } from "../../../utils/chain";

// INPUT
const requestQuerystringSchema = Type.Object({
  chain: chainIdOrSlugSchema,
  queueId: Type.Optional(
    Type.String({
      description: "The queue ID for a mined transaction.",
    }),
  ),
  transactionHash: Type.Optional({
    ...TransactionHashSchema,
    description: "The transaction hash for a mined transaction.",
  }),
  parseLogs: Type.Optional(
    Type.Boolean({
      description:
        "If true, parse the raw logs as events defined in the contract ABI. (Default: true)",
    }),
  ),
});

// OUTPUT
const LogSchema = Type.Object({
  address: AddressSchema,
  topics: Type.Array(Type.String()),
  data: Type.String(),
  blockNumber: Type.String(),
  transactionHash: TransactionHashSchema,
  transactionIndex: Type.Integer(),
  blockHash: Type.String(),
  logIndex: Type.Integer(),
  removed: Type.Boolean(),

  // Additional properties only for parsed logs
  eventName: Type.Optional(
    Type.String({
      description: "Event name, only returned when `parseLogs` is true",
    }),
  ),
  args: Type.Optional(
    Type.Unknown({
      description: "Event arguments. Only returned when `parseLogs` is true",
      examples: [
        {
          from: "0xdeadbeeefdeadbeeefdeadbeeefdeadbeeefdead",
          to: "0xdeadbeeefdeadbeeefdeadbeeefdeadbeeefdead",
          value: "1000000000000000000n",
        },
      ],
    }),
  ),
});

// DO NOT USE type.union
// this is known to cause issues with the generated types
export const responseBodySchema = Type.Object({
  result: Type.Array(LogSchema),
});

responseBodySchema.example = {
  result: [
    {
      eventName: "Transfer",
      args: {
        from: "0x0000000000000000000000000000000000000000",
        to: "0x71B6267b5b2b0B64EE058C3D27D58e4E14e7327f",
        value: "1000000000000000000n",
      },
      address: "0x71b6267b5b2b0b64ee058c3d27d58e4e14e7327f",
      topics: [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        "0x0000000000000000000000000000000000000000000000000000000000000000",
        "0x00000000000000000000000071b6267b5b2b0b64ee058c3d27d58e4e14e7327f",
      ],
      data: "0x0000000000000000000000000000000000000000000000000de0b6b3a7640000",
      blockNumber: "79326434",
      transactionHash:
        "0x568eb49d738f7c02ebb24aa329efcf10883d951b1e13aa000b0e073d54a0246e",
      transactionIndex: 1,
      blockHash:
        "0xaffbcf3232a76152206de5f6999c549404efc76060a34f8826b90c95993464c3",
      logIndex: 0,
      removed: false,
    },
  ],
};

export async function getTransactionLogs(fastify: FastifyInstance) {
  fastify.route<{
    Querystring: Static<typeof requestQuerystringSchema>;
    Reply: Static<typeof responseBodySchema>;
  }>({
    method: "GET",
    url: "/transaction/logs",
    schema: {
      summary: "Get transaction logs",
      description:
        "Get transaction logs for a mined transaction. A tranasction queue ID or hash must be provided. Set `parseLogs` to parse the event logs.",
      tags: ["Transaction"],
      operationId: "getTransactionLogs",
      querystring: requestQuerystringSchema,
      response: {
        ...standardResponseSchema,
        [StatusCodes.OK]: responseBodySchema,
      },
    },
    handler: async (request, reply) => {
      const {
        chain: inputChain,
        queueId,
        transactionHash,
        parseLogs = true,
      } = request.query;

      const chainId = await getChainIdFromChain(inputChain);
      const chain = await getChain(chainId);
      const rpcRequest = getRpcClient({
        client: thirdwebClient,
        chain,
      });

      if (!queueId && !transactionHash) {
        throw createCustomError(
          "Either a queue ID or transaction hash must be provided.",
          StatusCodes.BAD_REQUEST,
          "MISSING_TRANSACTION_ID",
        );
      }

      // Get the transaction hash from the provided input.
      let hash: Hex | undefined;
      if (queueId) {
        const transaction = await TransactionDB.get(queueId);
        if (transaction?.status === "mined") {
          hash = transaction.transactionHash;
        }
      } else if (transactionHash) {
        hash = transactionHash as Hex;
      }
      if (!hash) {
        throw createCustomError(
          "Could not find transaction, or transaction is not mined.",
          StatusCodes.BAD_REQUEST,
          "TRANSACTION_NOT_MINED",
        );
      }

      // Try to get the receipt.
      let transactionReceipt: TransactionReceipt | undefined;
      try {
        transactionReceipt = await eth_getTransactionReceipt(rpcRequest, {
          hash,
        });
      } catch {
        throw createCustomError(
          "Unable to get transaction receipt. The transaction may not have been mined yet.",
          StatusCodes.BAD_REQUEST,
          "TRANSACTION_NOT_MINED",
        );
      }

      if (!parseLogs) {
        return reply.status(StatusCodes.OK).send({
          result: superjson.serialize(transactionReceipt.logs).json as Static<
            typeof LogSchema
          >[],
        });
      }

      if (!transactionReceipt.to) {
        throw createCustomError(
          "Transaction logs are only supported for contract calls.",
          StatusCodes.BAD_REQUEST,
          "TRANSACTION_LOGS_UNAVAILABLE",
        );
      }

      const contracts = new Set<string>();
      contracts.add(transactionReceipt.to);
      for (const log of transactionReceipt.logs) {
        if (log.address) {
          contracts.add(log.address);
        }
      }

      const eventSignaturePromises = Array.from(contracts).map(
        async (address) => {
          const contract = getContract({
            address,
            chain,
            client: thirdwebClient,
          });

          const abi: AbiEvent.AbiEvent[] = await resolveContractAbi(contract);
          const eventSignatures = abi.filter((item) => item.type === "event");
          return eventSignatures;
        },
      );

      const combinedEventSignatures: AbiEvent.AbiEvent[] = (
        await Promise.all(eventSignaturePromises)
      ).flat();

      if (combinedEventSignatures.length === 0) {
        throw createCustomError(
          "No events found in contract or could not resolve contract ABI",
          StatusCodes.BAD_REQUEST,
          "NO_EVENTS_FOUND",
        );
      }

      const preparedEvents = combinedEventSignatures.map((signature) =>
        prepareEvent({ signature }),
      );

      const parsedLogs = parseEventLogs({
        events: preparedEvents,
        logs: transactionReceipt.logs,
        strict: false,
      });

      reply.status(StatusCodes.OK).send({
        result: superjson.serialize(parsedLogs).json as Static<
          typeof LogSchema
        >[],
      });
    },
  });
}
