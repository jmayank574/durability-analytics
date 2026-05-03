import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";

const COLORS = {
  asphalt:     "#60a5fa",
  cobblestone: "#fb923c",
  dirt:        "#4ade80",
};

const N_DISPLAY_BINS = 24;

function rebinHistogram(rangeHist, rangeBins, globalMax) {
  const binWidth = globalMax / N_DISPLAY_BINS;
  return Array.from({ length: N_DISPLAY_BINS }, (_, i) => {
    const low  = i * binWidth;
    const high = (i + 1) * binWidth;
    let count  = 0;
    for (let j = 0; j < rangeHist.length; j++) {
      const bLow  = rangeBins[j];
      const bHigh = rangeBins[j + 1];
      if (bHigh > low && bLow < high) {
        const overlap = Math.min(bHigh, high) - Math.max(bLow, low);
        count += rangeHist[j] * (overlap / (bHigh - bLow));
      }
    }
    return count;
  });
}

export default function RainflowChart({ data }) {
  const byRoad = data?.by_road_class || {};
  if (!Object.keys(byRoad).length) return null;

  const globalMax = Math.max(...Object.values(byRoad).map(v => v.range_max ?? 0));
  if (globalMax === 0) return null;

  const binWidth = globalMax / N_DISPLAY_BINS;

  const chartData = Array.from({ length: N_DISPLAY_BINS }, (_, i) => {
    const mid   = (i + 0.5) * binWidth;
    const point = { range: mid.toFixed(1) };
    Object.entries(byRoad).forEach(([road, vals]) => {
      if (!vals.range_hist || !vals.range_bins) return;
      const rebinned = rebinHistogram(vals.range_hist, vals.range_bins, globalMax);
      const count    = rebinned[i];
      // log₁₀ transform — null for empty bins so the area doesn't draw to zero
      point[road] = count > 0.5 ? parseFloat(Math.log10(count).toFixed(3)) : null;
    });
    return point;
  });

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const visible = payload.filter(p => p.value != null);
    if (!visible.length) return null;
    return (
      <div className="bg-slate-700 border border-slate-600 rounded-lg p-3 text-xs">
        <p className="text-slate-300 mb-1 font-medium">{label} m/s² amplitude</p>
        {visible.map(p => (
          <p key={p.dataKey} style={{ color: p.color }}>
            {p.dataKey}: {Math.round(10 ** p.value).toLocaleString()} cycles
          </p>
        ))}
      </div>
    );
  };

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
      <div className="flex items-start justify-between mb-1">
        <h2 className="text-sm font-semibold text-white">
          Rainflow cycle amplitude distribution
        </h2>
        <div className="flex gap-3">
          {Object.entries(byRoad).map(([road, vals]) => (
            <span key={road} className="text-xs text-slate-400">
              <span
                className="inline-block w-2 h-2 rounded-full mr-1"
                style={{ backgroundColor: COLORS[road] }}
              />
              {road}: {Math.round(vals.n_cycles ?? 0).toLocaleString()} cycles
            </span>
          ))}
        </div>
      </div>
      <p className="text-slate-400 text-xs mb-5">
        ASTM E1049 · cycle range histogram · log₁₀ scale
      </p>

      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 20, left: 8 }}>
          <defs>
            {Object.entries(COLORS).map(([road, color]) => (
              <linearGradient key={road} id={`grad-${road}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={color} stopOpacity={0.3} />
                <stop offset="95%" stopColor={color} stopOpacity={0.05} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis
            dataKey="range"
            tick={{ fill: "#94a3b8", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            interval={3}
            label={{
              value:    "Cycle range (m/s²)",
              position: "insideBottom",
              fill:     "#64748b",
              fontSize: 10,
              dy:       18,
            }}
          />
          <YAxis
            tick={{ fill: "#94a3b8", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            label={{
              value:    "log₁₀ cycles",
              angle:    -90,
              position: "insideLeft",
              fill:     "#64748b",
              fontSize: 10,
              dx:       -2,
            }}
          />
          <Tooltip content={<CustomTooltip />} />
          {Object.keys(byRoad)
            .filter(road => COLORS[road])
            .map(road => (
              <Area
                key={road}
                type="monotone"
                dataKey={road}
                stroke={COLORS[road]}
                strokeWidth={2}
                fill={`url(#grad-${road})`}
                dot={false}
                connectNulls={false}
              />
            ))}
        </AreaChart>
      </ResponsiveContainer>

    </div>
  );
}
