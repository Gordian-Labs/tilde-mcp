import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import axios from "axios";
import { withPaymentInterceptor } from "x402-axios";
import { z } from "zod";
import { getNetworkType, createSigner } from "./execute.js";

interface FilterDefaults {
  supportedNetworks?: string[];
  supportedAssets?: string[];
  supportedFacilitators?: string[];
}

export function registerSearchTool(
  server: McpServer,
  searchApiUrl: string,
  evmPrivateKey: string | undefined,
  solanaPrivateKey: string | undefined,
  filterDefaults: FilterDefaults = {},
  maxNumResults: number = 10
) {
  // Determine payment network based on SUPPORTED_NETWORKS[0] (first preferred network)
  // If no default networks configured, fallback to 'base' for backward compatibility
  const preferredNetwork = filterDefaults.supportedNetworks?.[0] || 'base';
  const networkType = getNetworkType(preferredNetwork);

  // Select appropriate private key based on network type
  const privateKey = networkType === 'solana' ? solanaPrivateKey : evmPrivateKey;

  if (!privateKey) {
    throw new Error(
      `MCP configuration error: DEFAULT_NETWORKS[0]='${preferredNetwork}' requires ${networkType.toUpperCase()}_PRIVATE_KEY. ` +
      `Please add ${networkType.toUpperCase()}_PRIVATE_KEY to your MCP server configuration.`
    );
  }

  server.tool(
    "search_endpoints",
    "Search for x402-compliant data provider endpoints using natural language. Returns ranked endpoints with payment metadata, network support, and evidence snippets. Use this when you need to find APIs that provide specific data (prices, market data, blockchain data, etc.). payment amounts returned by the endpoint are in the decimals of the asset. Most of the time it is USDC, which has 6 decimal places, so you will need to divide the number by 10**6",
    {
      query: z.string().min(5).max(500).describe(
        "Detailed natural language search query. Be specific and thorough:\n" +
        "- Include data type (e.g., 'spot price', 'funding rate', 'wallet balance')\n" +
        "- Include asset symbols with variants (e.g., 'BTC/Bitcoin', 'ETH/Ethereum')\n" +
        "- Include temporal context (e.g., 'real-time', 'historical', 'live')\n" +
        "- Include network/blockchain ONLY for network-specific data (e.g., 'Solana validator metrics', 'Base gas prices')\n" +
        "- For generic asset data, omit network - filtering is handled by SUPPORTED_NETWORKS configuration\n" +
        "- Examples:\n" +
        "  1. 'Bitcoin BTC spot price real-time live current market data cryptocurrency quote trading'\n" +
        "  2. 'Ethereum ETH funding rate perpetual futures derivatives swap contract trading data'\n" +
        "  3. 'Solana network validator count active nodes blockchain metrics performance statistics'"
      ),
      numResults: z.number().int().min(1).max(maxNumResults).optional().describe(
        `Number of results to return (1-${maxNumResults}). Defaults to 10 if not specified.`
      ),
      mustIncludeKeywords: z.array(z.string().min(2).max(50)).min(3).max(12).describe(
        "REQUIRED: Array of 3-12 keywords that MUST appear in relevant API endpoints. You MUST provide at least 3 keywords and at most 12 keywords.\n\n" +
        "Be specific and thorough:\n" +
        "- Include data type keywords: 'price', 'spot', 'funding', 'balance', 'orderbook', 'ohlcv'\n" +
        "- IMPORTANT: Include ALL asset symbol variants (synonyms) for better results: ['BTC', 'Bitcoin', 'bitcoin', 'XBT'] for Bitcoin, ['ETH', 'Ethereum', 'ethereum'] for Ethereum\n" +
        "- Include technical terms: 'quote', 'ticker', 'market data', 'candles', 'time series'\n" +
        "- Include temporal keywords if relevant: 'real-time', 'live', 'historical', 'past'\n" +
        "- Avoid generic terms like 'data', 'api', 'service'\n" +
        "- Maximum 12 keywords - prioritize the most relevant terms\n" +
        "- Quality over quantity, but be thorough - aim for 5-8 highly relevant keywords\n\n" +
        "Example: For 'bitcoin price', use: ['price', 'spot', 'bitcoin', 'btc', 'quote', 'market', 'current', 'real-time']"
      ),
      mustExcludeKeywords: z.array(z.string().min(2).max(50)).max(5).optional().describe(
        "OPTIONAL: Array of 0-5 keywords indicating WRONG type of data. Results matching these keywords will be COMPLETELY EXCLUDED. Maximum 5 keywords allowed.\n\n" +
        "Examples:\n" +
        "- If query wants spot price, exclude: ['funding', 'rate', 'balance', 'wallet', 'transfer']\n" +
        "- If query wants real-time, exclude: ['historical', 'past', 'archive']\n" +
        "- If query wants historical, exclude: ['real-time', 'live', 'current']\n" +
        "- If query says 'NOT X', include all X-related terms here\n" +
        "- Only include keywords you're confident indicate irrelevant results\n" +
        "- Can be empty array or omitted if no clear exclusions\n\n" +
        "Example: For 'bitcoin price NOT funding rates', use: ['funding', 'rate', 'perpetual', 'futures']"
      ),
      qualityReqs: z.array(z.enum([
        "reliability", "low-latency", "high-volume"
      ])).optional().describe(
        "Quality requirements to prioritize. Use 'reliability' for uptime concerns, 'low-latency' for speed requirements, 'high-volume' for high-traffic needs. Use when user emphasizes quality, speed, or production readiness."
      ),
      temporal: z.enum([
        "real-time", "historical", "both", "unknown"
      ]).optional().describe(
        "Temporal requirements for the data. 'real-time' for current/live data (e.g., 'current price', 'live feed'), 'historical' for time-series/backtesting data (e.g., 'past prices', 'OHLCV data'), 'both' when either is acceptable. Extract from query context or infer from keywords like 'real-time', 'live', 'current' vs 'historical', 'past', 'time-series'."
      )
    },
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    },
    async (args, _extra) => {
      try {
        // Create appropriate signer for the search API payment
        // Uses single-network signer based on DEFAULT_NETWORKS[0] preference
        const signer = await createSigner(networkType, privateKey, preferredNetwork);

        // Create axios client with x402 payment interceptor
        // Type assertion needed due to viem/x402-axios type compatibility
        // x402-axios auto-detects signer type (EVM or Solana) and routes accordingly
        const client = withPaymentInterceptor(
          axios.create({
            decompress: false // Disable to avoid state pollution with retry logic
          }),
          signer as any
        );

        // Call search-api with automatic payment handling
        // Inject global filter defaults from MCP configuration
        const response = await client.post(
          `${searchApiUrl}/search`,
          {
            q: args.query,
            n: Math.min(args.numResults ?? 10, maxNumResults),
            mustIncludeKeywords: args.mustIncludeKeywords,
            mustExcludeKeywords: args.mustExcludeKeywords || [],
            qualityReqs: args.qualityReqs,
            temporal: args.temporal,
            // Add filter defaults if configured (empty/undefined = no filter)
            ...(filterDefaults.supportedNetworks?.length && { networks: filterDefaults.supportedNetworks }),
            ...(filterDefaults.supportedAssets?.length && { assets: filterDefaults.supportedAssets }),
            ...(filterDefaults.supportedFacilitators?.length && { sources: filterDefaults.supportedFacilitators })
          },
          {
            headers: { "Content-Type": "application/json" },
            timeout: 30000
          }
        );

        // Return results in MCP format
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(response.data, null, 2)
            }
          ]
        };
      } catch (error) {
        if (axios.isAxiosError(error)) {
          // Payment failure or API error
          console.error(`Search request failed: ${error.message}`);

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
        throw new Error(`Search failed: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }
  );
}
