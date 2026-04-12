import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";

const COLORS = {
  asphalt:     "#60a5fa",
  cobblestone: "#fb923c",
  dirt:        "#4ade80",
};

export default function PSDChart({ data }) {
  const byRoad = data.by_road_class || {};

  // Sample every 5th frequency point for performance
  const firstRoad = Object.values(byRoad)[0];
  if (!firstRoad) return null;

  const freqs = firstRoad.freqs.filter((_, i) => i % 5 === 0);

  const chartData = freqs.map((freq, i) => {
    const point = { freq: parseFloat(freq.toFixed(1)) };
    Object.entries(byRoad).forEach(([road, vals]) => {
      const psdVal = vals.psd_mean[i * 5];
      point[road] = psdVal > 0
        ? parseFloat(Math.log10(psdVal).toFixed(3))
        : null;
    });
    return point;
  }).filter(p => p.freq <= 50);

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-slate-700 border border-slate-600 
                      rounded-lg p-3 text-xs">
        <p className="text-slate-300 mb-1">{label} Hz</p>
        {payload.map(p => (
          <p key={p.dataKey} style={{ color: p.color }}>
            {p.dataKey}: {(10 ** p.value).toExponential(2)} (m/s²)²/Hz
          </p>
        ))}
      </div>
    );
  };

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
      <h2 className="text-sm font-semibold text-white mb-1">
        Power Spectral Density by road class
      </h2>
      <p className="text-slate-400 text-xs mb-5">
        Welch's method · below suspension sensor · log₁₀ scale
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chartData}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="#334155"
            vertical={false}
          />
          <XAxis
            dataKey="freq"
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            label={{
              value: "Frequency (Hz)",
              position: "insideBottom",
              fill: "#64748b",
              fontSize: 10,
              dy: 10,
            }}
          />
          <YAxis
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            label={{
              value: "log₁₀ PSD",
              angle: -90,
              position: "insideLeft",
              fill: "#64748b",
              fontSize: 10,
              dx: -5,
            }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: "11px", color: "#94a3b8" }}
          />
          {Object.keys(byRoad).map(road => (
            <Line
              key={road}
              type="monotone"
              dataKey={road}
              stroke={COLORS[road] || "#94a3b8"}
              dot={false}
              strokeWidth={2}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}