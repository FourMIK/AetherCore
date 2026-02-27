# GitHub Copilot MCP Configuration

This document describes the Model Context Protocol (MCP) configuration for GitHub Copilot agents in the AetherCore repository.

## Overview

The MCP configuration enables GitHub Copilot coding agents to access GitHub APIs and repository information through the GitHub MCP server. This provides enhanced context and capabilities for AI-assisted development.

## Configuration File

The MCP configuration is stored in `.github/mcp.json` in the repository root.

## GitHub MCP Server

The configuration includes the GitHub MCP server which provides:
- Access to GitHub APIs
- Repository information and metadata
- Issue and pull request management
- Code search and analysis capabilities
- Workflow and Actions integration

### Configuration Details

```json
{
  "mcpServers": {
    "github": {
      "type": "stdio",
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-i",
        "--pull=always",
        "-e",
        "GITHUB_PERSONAL_ACCESS_TOKEN",
        "ghcr.io/github/github-mcp-server"
      ],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${COPILOT_MCP_GITHUB_PERSONAL_ACCESS_TOKEN}"
      },
      "tools": ["*"]
    }
  }
}
```

### Key Components

- **mcpServers**: Top-level object containing all MCP server configurations
- **type**: Set to `"stdio"` for standard input/output communication
- **command**: Uses Docker to run the MCP server in a containerized environment
- **args**: Docker run arguments including:
  - `--rm`: Automatically remove container when it exits
  - `-i`: Keep STDIN open for interactive communication
  - `--pull=always`: Always pull the latest server image
  - `-e GITHUB_PERSONAL_ACCESS_TOKEN`: Pass the environment variable to the container
- **env**: Environment variable mapping
  - Maps `GITHUB_PERSONAL_ACCESS_TOKEN` from the Copilot secret `COPILOT_MCP_GITHUB_PERSONAL_ACCESS_TOKEN`
- **tools**: Array of allowed tools, `["*"]` enables all available tools

## Security Considerations

### Token Management

The configuration uses environment variable substitution to securely pass the GitHub Personal Access Token:

1. **Never hardcode tokens** in the configuration file
2. The token is provided by Copilot from the secret `COPILOT_MCP_GITHUB_PERSONAL_ACCESS_TOKEN`
3. The token is only accessible to the MCP server process
4. The Docker container is ephemeral and removed after use

### Token Permissions

The GitHub Personal Access Token used should have appropriate permissions for the intended operations:

- `repo`: Full control of private repositories (for repository access)
- `workflow`: Update GitHub Action workflows (if needed)
- `read:org`: Read organization membership (if accessing organization repositories)

**Note**: Follow the principle of least privilege - only grant the minimum required permissions.

## Troubleshooting

### Error: "GITHUB_PERSONAL_ACCESS_TOKEN not set"

This error indicates that the Copilot environment secret is not configured:

1. Ensure the secret `COPILOT_MCP_GITHUB_PERSONAL_ACCESS_TOKEN` is set in the Copilot environment
2. Verify the secret name matches exactly (case-sensitive)
3. Check that the token has not expired

### Error: "missing type"

This error indicates an invalid MCP configuration schema:

1. Verify that `type: "stdio"` is present in the server configuration
2. Ensure the JSON structure matches the schema shown above
3. Check for JSON syntax errors

### Docker Issues

If the MCP server fails to start with Docker-related errors:

1. Ensure Docker is installed and running
2. Verify network access to `ghcr.io` (GitHub Container Registry)
3. Check Docker permissions for the user running Copilot

## References

- [GitHub MCP Server Documentation](https://github.com/github/github-mcp-server)
- [Model Context Protocol Specification](https://modelcontextprotocol.io)
- [GitHub Copilot Custom Agents](https://docs.github.com/en/copilot/customizing-copilot/creating-custom-agents)
