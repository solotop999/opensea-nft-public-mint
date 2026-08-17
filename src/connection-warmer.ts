import chalk from "chalk";

// Pre-establish TCP/TLS to every RPC so the first real request doesn't pay for
// a handshake. Some endpoints (Base's sequencer, for one) only accept send
// methods, so we warm with eth_sendRawTransaction and ignore the error — the
// handshake is the point, not the response.
export async function warmConnections(rpcUrls: string[]): Promise<void> {
  console.log(chalk.gray("  Đang làm nóng kết nối..."));

  await Promise.all(
    rpcUrls.map((url) =>
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_sendRawTransaction",
          params: ["0x00"],
          id: 1,
        }),
      })
        .then(() => {})
        .catch(() => {})
    )
  );

  console.log(chalk.green("  Kết nối đã sẵn sàng."));
}
