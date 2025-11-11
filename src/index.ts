import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "dotenv";
import { registerSearchTool } from "./tools/search.js";
import { registerExecuteTool } from "./tools/execute.js";

// Load environment variables (silently for stdio transport)
// Set DOTENV_CONFIG_QUIET to suppress informational messages on stdout
process.env.DOTENV_CONFIG_QUIET = 'true';
config();

// Parse global search filter defaults from environment
// Comma-separated lists are split into arrays, empty/undefined = no filter applied
const supportedNetworks = process.env.SUPPORTED_NETWORKS
  ?.split(',')
  .map(s => s.trim())
  .filter(Boolean);

const supportedAssets = process.env.SUPPORTED_ASSETS
  ?.split(',')
  .map(s => s.trim())
  .filter(Boolean);

const supportedFacilitators = process.env.SUPPORTED_FACILITATORS
  ?.split(',')
  .map(s => s.trim())
  .filter(Boolean);

// Parse MAX_NUM_RESULTS (controls maximum search results agent can request)
// Default to 10 if not specified
const maxNumResults = parseInt(process.env.MAX_NUM_RESULTS || '10', 10);

// Validate MAX_NUM_RESULTS is a positive integer
if (isNaN(maxNumResults) || maxNumResults <= 0) {
  console.error('[MCP] Error: MAX_NUM_RESULTS must be a positive integer');
  console.error(`[MCP] Current value: "${process.env.MAX_NUM_RESULTS}"`);
  console.error('[MCP] Example: MAX_NUM_RESULTS=10');
  process.exit(1);
}

// Log configured maximum
console.error(`[MCP] Maximum search results: ${maxNumResults}`);

// Hardcoded search API URL (change to https://api.tilde.com in production)
const searchApiUrl = "https://search-api-0tde.onrender.com";

// Parse private keys (both optional, but need at least one)
const evmPrivateKey = process.env.EVM_PRIVATE_KEY;
const solanaPrivateKey = process.env.SOLANA_PRIVATE_KEY;

// Validate at least one key provided
if (!evmPrivateKey && !solanaPrivateKey) {
  console.error('[MCP] Error: At least one of EVM_PRIVATE_KEY or SOLANA_PRIVATE_KEY is required');
  console.error('[MCP] Add one or both keys to your Claude MCP config env section');
  process.exit(1);
}

// Validate SUPPORTED_NETWORKS is required
if (!supportedNetworks || supportedNetworks.length === 0) {
  console.error('[MCP] Error: SUPPORTED_NETWORKS is required');
  console.error('[MCP] Set SUPPORTED_NETWORKS to match the keys you provided:');

  // Provide smart suggestions based on available keys
  if (evmPrivateKey && solanaPrivateKey) {
    console.error('[MCP]   Suggestion: SUPPORTED_NETWORKS=base,solana (you have both keys)');
  } else if (evmPrivateKey && !solanaPrivateKey) {
    console.error('[MCP]   Suggestion: SUPPORTED_NETWORKS=base (you have EVM key)');
  } else if (!evmPrivateKey && solanaPrivateKey) {
    console.error('[MCP]   Suggestion: SUPPORTED_NETWORKS=solana (you have Solana key)');
  }

  console.error('[MCP] Add SUPPORTED_NETWORKS to your Claude MCP config env section');
  process.exit(1);
}

// Validate that configured networks have corresponding keys
// Note: Network name validation is handled by search-api
if (supportedNetworks && supportedNetworks.length > 0) {
  for (const network of supportedNetworks) {
    const isSolana = network.toLowerCase() === 'solana';

    if (isSolana && !solanaPrivateKey) {
      console.error(`[MCP] Error: Network '${network}' in SUPPORTED_NETWORKS requires SOLANA_PRIVATE_KEY`);
      console.error('[MCP] Either add SOLANA_PRIVATE_KEY or remove "solana" from SUPPORTED_NETWORKS');
      process.exit(1);
    } else if (!isSolana && !evmPrivateKey) {
      console.error(`[MCP] Error: Network '${network}' in SUPPORTED_NETWORKS requires EVM_PRIVATE_KEY`);
      console.error(`[MCP] Either add EVM_PRIVATE_KEY or remove "${network}" from SUPPORTED_NETWORKS`);
      process.exit(1);
    }
  }
}

// Log available payment capabilities
console.error('[MCP] Payment capabilities:');
if (evmPrivateKey) {
  console.error('[MCP]   ✓ EVM payments available (Base blockchain)');
}
if (solanaPrivateKey) {
  console.error('[MCP]   ✓ Solana payments available');
}

// Create MCP server
const server = new McpServer({
  name: "tilde-x402-server",
  version: "1.0.0",
});

// Register search_endpoints tool with x402 payment handling
// Pass both private keys - search tool will select the appropriate one based on SUPPORTED_NETWORKS[0]
// We've already validated that at least one key exists and matches SUPPORTED_NETWORKS
registerSearchTool(server, searchApiUrl, evmPrivateKey, solanaPrivateKey, {
  supportedNetworks,
  supportedAssets,
  supportedFacilitators,
}, maxNumResults);

// Register execute_tool with x402 payment handling (both keys passed)
registerExecuteTool(server, evmPrivateKey, solanaPrivateKey);

// Connect stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
