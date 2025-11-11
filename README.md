# Tilde x402 MCP Server

Tilde is a search engine for AI agents to discover and pay for x402-enabled services using natural language. Tilde returns only the most relevant endpoints for each query which reduces inference costs and context contamination.

## Features

- **Multi-chain support**: Native support for Base (EVM) and Solana blockchain payments
- **Natural language search**: Semantic search powered by keyword filtering and network/asset/facilitator filters
- **Context optimization**: Returns only the most relevant results to reduce agent context bloat

## Tools

- **search_endpoints**: Discover x402-enabled APIs using natural language queries with semantic search
- **execute_tool**: Call discovered endpoints with automatic x402 payment handling

## Prerequisites

Before you begin, ensure you have:

- **Private keys**: At least one private key for signing payments on the network you want to use
  - `SOLANA_PRIVATE_KEY`: For Solana network (base58 format, 87-88 characters) - from Phantom, Solflare, or `solana-keygen new`
  - `EVM_PRIVATE_KEY`: For EVM networks (hex format with 0x prefix) - from MetaMask, Rainbow, or other EVM wallet
- **MCP Client**: [Claude Desktop](https://claude.ai/download), [Cursor](https://cursor.sh), etc.,

## Configuration

This MCP server is designed to work with any MCP client, including Claude Desktop and Cursor. Add the configuration to your MCP client's config file:

- **Claude Desktop**: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
- **Cursor**: Configuration via MCP settings UI

### Environment Variables

**Required** (at least one):
- `SOLANA_PRIVATE_KEY`: Your Solana private key for signing x402 payments on Solana
- `EVM_PRIVATE_KEY`: Your EVM private key for signing x402 payments on Base (and future EVM chains)

**Required** (network configuration):
- `SUPPORTED_NETWORKS`: Filter search results to specific blockchain networks (e.g., `solana`, `base`, or `solana,base`)
  - Must match the keys you provided (e.g., if you have SOLANA_PRIVATE_KEY, use `solana`)
  - Multiple networks: `solana,base` (comma-separated)

**Optional Global Filter Defaults** (comma-separated lists):
- `SUPPORTED_ASSETS`: Filter search results to specific payment assets (e.g., `USDC,ETH,SOL,CASH`)
- `SUPPORTED_FACILITATORS`: Filter search results to specific data providers (e.g., `coinbase,payai`)

**Filter Behavior**:
- **SUPPORTED_NETWORKS**: Required - must explicitly set networks you want to search
- **SUPPORTED_ASSETS, SUPPORTED_FACILITATORS**: Optional - empty means no filtering
- **Multiple values**: Use comma-separated lists (e.g., `SUPPORTED_NETWORKS=solana,base`)

These filters are applied at the MCP server level and are not exposed as tool parameters to the AI agent. All search requests will automatically include these filters.

## Multi-Chain Configuration

The MCP server supports payments on both EVM chains (Base currently) and Solana. You need to provide private keys for the blockchain types you want to use.

### Configuration Examples

**Solana Only:**
```json
{
  "mcpServers": {
    "tilde-mcp": {
      "command": "npx",
      "args": ["-y", "tilde-mcp@latest"],
      "env": {
        "SOLANA_PRIVATE_KEY": "YourSolanaBase58PrivateKeyHere",
        "SUPPORTED_NETWORKS": "solana",
        "SUPPORTED_ASSETS": "USDC",
        "SUPPORTED_FACILITATORS": "coinbase",
        "MAX_NUM_RESULTS": "7"
      }
    }
  }
}
```

**Multi-Chain (Solana + Base):**
```json
{
  "mcpServers": {
    "tilde-mcp": {
      "command": "npx",
      "args": ["-y", "tilde-mcp@latest"],
      "env": {
        "SOLANA_PRIVATE_KEY": "YourSolanaBase58PrivateKeyHere",
        "EVM_PRIVATE_KEY": "0xYourEVMPrivateKeyHere",
        "SUPPORTED_NETWORKS": "solana,base",
        "SUPPORTED_ASSETS": "USDC",
        "SUPPORTED_FACILITATORS": "coinbase,payai",
        "MAX_NUM_RESULTS": "7"
      }
    }
  }
}
```

## Development

For contributors who want to modify or extend the MCP server:

### Local Setup

```bash
# Clone the repository
git clone https://github.com/Gordian-Labs/tilde-mcp.git
cd tilde-mcp

# Install dependencies
npm install

# Build TypeScript
npm run build
```

### Using Local Build with MCP Client

To test local changes, point your MCP client config to the local build:

```json
{
  "mcpServers": {
    "tilde-mcp-dev": {
      "command": "node",
      "args": ["/absolute/path/to/tilde-mcp/dist/index.js"],
      "env": {
        "SOLANA_PRIVATE_KEY": "YourSolanaBase58PrivateKeyHere",
        "SUPPORTED_NETWORKS": "solana"
      }
    }
  }
}
```

## Acknowledgments

- [Model Context Protocol](https://modelcontextprotocol.io) for the MCP specification
- [x402 Protocol](https://www.x402.org/) for HTTP-native blockchain payment rails
- [Anthropic](https://anthropic.com) for Claude Desktop and MCP client support
