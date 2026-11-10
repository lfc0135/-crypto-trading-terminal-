export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startEmbeddedTrader } = await import("./lib/trader/runtime");
  startEmbeddedTrader();
}
