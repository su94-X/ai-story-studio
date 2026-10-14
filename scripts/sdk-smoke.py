"""Optional interoperability test using the official MCP Python SDK (tested 1.29.1)."""
import asyncio
import json
from pathlib import Path
import shutil
import tempfile

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def main():
    server = Path(__file__).resolve().parents[1] / "mcp" / "server.mjs"
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node.js is required")
    with tempfile.TemporaryDirectory(prefix="story-studio-sdk-") as workspace:
        project = Path(workspace) / "project"
        project.mkdir()
        params = StdioServerParameters(command=node, args=[str(server), "--workspace", workspace])
        async with stdio_client(params) as streams:
            async with ClientSession(*streams) as client:
                initialized = await client.initialize()
                tools = await client.list_tools()
                result = await client.call_tool("studio_open_project", {"project_root": str(project), "project_id": "sdk-demo"})
                assert len(tools.tools) == 15
                assert result.isError is False
                assert result.structuredContent["revision"] == 0
                recovered = await client.call_tool("studio_recover_project", {"project_root": str(project)})
                assert recovered.structuredContent["projectId"] == "sdk-demo"
                print(json.dumps({"protocol": initialized.protocolVersion, "tools": len(tools.tools), "initialize": "pass", "tool_call": "pass", "recovery": "pass"}))


if __name__ == "__main__":
    asyncio.run(main())
