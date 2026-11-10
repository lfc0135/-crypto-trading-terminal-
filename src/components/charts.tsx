"use client";

import { useEffect, useRef } from "react";
import { ColorType, createChart, type UTCTimestamp } from "lightweight-charts";

export function CandleChart({ candles }: { candles: { time: number; open: number; high: number; low: number; close: number }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      height: 380,
      layout: { background: { type: ColorType.Solid, color: "#141b24" }, textColor: "#8e9bb0" },
      grid: { vertLines: { color: "#222b38" }, horzLines: { color: "#222b38" } },
      rightPriceScale: { borderColor: "#2a3544" },
      timeScale: { borderColor: "#2a3544", timeVisible: true, secondsVisible: false },
    });
    const series = chart.addCandlestickSeries({
      upColor: "#3dbe8a",
      downColor: "#ef5d6f",
      borderUpColor: "#3dbe8a",
      borderDownColor: "#ef5d6f",
      wickUpColor: "#3dbe8a",
      wickDownColor: "#ef5d6f",
    });
    series.setData(candles.map((bar) => ({
      time: Math.floor(bar.time / 1000) as UTCTimestamp,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
    })));
    chart.timeScale().fitContent();
    const observer = new ResizeObserver(() => chart.applyOptions({ width: ref.current?.clientWidth ?? 0 }));
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      chart.remove();
    };
  }, [candles]);
  return <div ref={ref} className="h-[380px] w-full" />;
}

export function LineChart({ points }: { points: { time: number; value: number }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      height: 260,
      layout: { background: { type: ColorType.Solid, color: "#141b24" }, textColor: "#8e9bb0" },
      grid: { vertLines: { color: "#222b38" }, horzLines: { color: "#222b38" } },
      rightPriceScale: { borderColor: "#2a3544" },
      timeScale: { borderColor: "#2a3544", timeVisible: true },
    });
    const series = chart.addLineSeries({ color: "#d6b15e", lineWidth: 2 });
    const dedup = new Map<number, number>();
    for (const point of points) dedup.set(Math.floor(point.time / 1000), point.value);
    series.setData([...dedup.entries()].sort((a, b) => a[0] - b[0]).map(([time, value]) => ({ time: time as UTCTimestamp, value })));
    chart.timeScale().fitContent();
    const observer = new ResizeObserver(() => chart.applyOptions({ width: ref.current?.clientWidth ?? 0 }));
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      chart.remove();
    };
  }, [points]);
  return <div ref={ref} className="h-[260px] w-full" />;
}
