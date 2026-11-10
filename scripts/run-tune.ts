import { runTuningJob } from "../src/lib/server/tune-job";

runTuningJob()
  .then((result) => {
    console.log(result.note);
    console.log("rows", result.rows.length, "armed", result.rows.filter((row) => row.armed).length);
    for (const row of result.rows) {
      const test = row.test;
      console.log(
        [
          row.symbol,
          row.strategyId,
          row.bar,
          test ? `${(test.totalReturnPct * 100).toFixed(2)}%` : "n/a",
          test ? `${(test.maxDrawdownPct * 100).toFixed(2)}%` : "n/a",
          test ? `${(test.hitRate * 100).toFixed(1)}%` : "n/a",
          row.armed ? "armed" : row.rejectReason,
        ].join(" | "),
      );
    }
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
