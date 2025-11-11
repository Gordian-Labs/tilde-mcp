import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import axios from "axios";
import { privateKeyToAccount } from "viem/accounts";
import { withPaymentInterceptor, createSigner as x402CreateSigner } from "x402-axios";
import { z } from "zod";
import { Hex, createWalletClient, http, publicActions } from "viem";
import { base } from "viem/chains";

/**
 * Determine if a network is Solana or EVM
 * Solana is hardcoded as the only non-EVM chain
 */
export function getNetworkType(network: string): 'evm' | 'solana' {
  const normalizedNetwork = network.toLowerCase();
  if (normalizedNetwork === 'solana') return 'solana';
  return 'evm'; // Everything else is EVM (base, ethereum, polygon, etc.)
}

/**
 * Create appropriate signer based on network type
 * Returns viem wallet client for EVM or Solana Keypair for Solana
 * x402-axios auto-detects signer type via internal checks
 */
export async function createSigner(
  networkType: 'evm' | 'solana',
  privateKey: string,
  _network: string  // Unused for now, will be used in PHASE-5 for dynamic chain selection
): Promise<any> {
  if (networkType === 'solana') {
    // Use x402-axios's built-in createSigner for Solana
    // This returns the proper SvmSigner interface that x402 expects
    return await x402CreateSigner('solana', privateKey);
  } else {
    // Create EVM signer (viem wallet client) - already working
    const formattedKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    const account = privateKeyToAccount(formattedKey as Hex);
    const chain = base; // Currently hardcoded to Base (PHASE-5 will make dynamic)

    return createWalletClient({
      account,
      chain,
      transport: http()
    }).extend(publicActions);
  }
}

export function registerExecuteTool(
  server: McpServer,
  evmPrivateKey: string | undefined,
  solanaPrivateKey: string | undefined
) {
  server.tool(
    "execute_tool",
    "Execute a call to an x402-enabled endpoint from search results. Automatically handles payment if the endpoint requires it (HTTP 402). Pass the endpoint object from search_endpoints results along with any parameters needed for the API call.",
    {
      endpoint: z.object({
        resource: z.string().url(),
        accepts: z.array(z.object({
          asset: z.string(),
          network: z.string(),
          payTo: z.string(),
          maxAmountRequired: z.string(),
          scheme: z.string().optional(),
          mimeType: z.string().optional()
        }))
      }),
      params: z.record(z.any()).optional(),
      method: z.enum(["GET", "POST", "PUT", "DELETE"]).optional(),
      body: z.any().optional()
    },
    {
      readOnlyHint: false,  // Makes HTTP requests
      destructiveHint: false,  // Doesn't delete/modify data (depends on endpoint)
      idempotentHint: false,  // Results may vary
      openWorldHint: true
    },
    async (args, _extra) => {
      try {
        const { endpoint, params, method, body } = args;

        // Detect network type and get appropriate key
        const endpointNetwork = endpoint.accepts[0].network;
        const networkType = getNetworkType(endpointNetwork);
        const privateKey = networkType === 'solana' ? solanaPrivateKey : evmPrivateKey;

        if (!privateKey) {
          throw new Error(
            `${networkType.toUpperCase()} endpoint requires ${networkType.toUpperCase()}_PRIVATE_KEY in MCP configuration. ` +
            `Add ${networkType.toUpperCase()}_PRIVATE_KEY to your Claude config env section.`
          );
        }

        // Create appropriate signer (EVM or Solana)
        const signer = await createSigner(networkType, privateKey, endpointNetwork);

        // Extract URL components
        const resourceUrl = endpoint.resource;
        const url = new URL(resourceUrl);
        const baseURL = `${url.protocol}//${url.host}`;
        const path = url.pathname + url.search;

        // Create axios client with x402 payment interceptor
        // x402-axios auto-detects signer type via internal checks and routes accordingly
        // Disable decompression to avoid state pollution issues with retry logic
        const client = withPaymentInterceptor(
          axios.create({
            baseURL,
            decompress: false
          }),
          signer as any
        );

        // Prepare request config
        const config: any = {
          method: method || "GET",
          url: path,
          timeout: 60000
        };

        // Add query params if provided
        if (params) {
          config.params = params;
        }

        // Initialize headers object (always present for x402-axios interceptor)
        config.headers = { ...config.headers };

        // Add body for POST/PUT
        if (body !== undefined && (method === "POST" || method === "PUT")) {
          config.data = body;
          config.headers["Content-Type"] = "application/json";
        }

        // Make request (x402-axios handles 402 payment automatically)
        const response = await client.request(config);

        // Return response data
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                status: response.status,
                data: response.data
              }, null, 2)
            }
          ]
        };

      } catch (error) {
        if (axios.isAxiosError(error)) {
          // Payment failure or API error
          console.error(`Request failed: ${error.message}`);

          const errorData = {
            success: false,
            status: error.response?.status,
            message: error.message,
            data: error.response?.data
          };

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(errorData, null, 2)
              }
            ],
            isError: true
          };
        }

        console.error(`Unexpected error: ${error}`);
        throw new Error(`Execution failed: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }
  );
}
