import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createReviewInsightsServer } from "../mcp/server";

export interface HostClient {
  call(name: string, args: Record<string, unknown>): Promise<unknown>;
  client: Client;
}

/** Connects an in-process MCP client to the Groww Insights MCP server and runs `fn`. */
export async function withMcpClient<T>(
  fn: (host: HostClient) => Promise<T>,
): Promise<T> {
  const server = createReviewInsightsServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({
    name: "groww-insight-web-host",
    version: "1.0.0",
  });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  const host: HostClient = {
    client,
    async call(name, args) {
      const res = (await client.callTool({ name, arguments: args as never })) as unknown as {
        content?: Array<{ type?: string; text?: string }>;
        isError?: boolean;
      };
      const text = (res?.content ?? [])
        .filter((c) => c?.type === "text" && typeof c.text === "string")
        .map((c) => c.text)
        .join("\n");
      if (res?.isError) {
        throw new Error(`MCP tool error: ${text || "unknown"}`);
      }
      try {
        return JSON.parse(text || "{}");
      } catch {
        return { raw: text };
      }
    },
  };

  try {
    return await fn(host);
  } finally {
    await client.close();
  }
}