import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from "recharts";

const CLUSTER_COLORS = ["#60a5fa", "#fb923c", "#4ade80", "#a78bfa"];

export default function ArchetypePanel({ data }) {
  const clustering = data.clustering || {};
  const profiles   = clustering.cluster_profiles || [];

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
      <div className="bg-slate-700 border border-slate-600 
                      rounded-lg p-3 text-xs">
        <p className="font-medium text-white mb-1">
          Cluster {d.cluster_id}
        </p>
        <p className="text-slate-300">{d.archetype}</p>
        <p className="text-slate-400">Windows: {d.n_windows}</p>
        <p className="text-slate-400">
          Dominant road: {d.dominant_road}
        </p>
      </div>
    );
  };

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
      <h2 className="text-sm font-semibold text-white mb-1">
        Usage archetype clusters
      </h2>
      <p className="text-slate-400 text-xs mb-5">
        K-Means · k={clustering.n_clusters}
      </p>

      {/* Cluster cards */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        {profiles.map((profile, i) => (
          <div
            key={i}
            className="rounded-lg p-3 border"
            style={{
              backgroundColor: `${CLUSTER_COLORS[i]}15`,
              borderColor:     `${CLUSTER_COLORS[i]}40`,
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: CLUSTER_COLORS[i] }}
              />
              <span className="text-xs font-medium text-white">
                C{profile.cluster_id}
              </span>
              <span
                className="text-slate-400 ml-auto"
                style={{ fontSize: "10px" }}
              >
                {profile.n_windows} windows
              </span>
            </div>
            <p
              className="text-slate-300 capitalize mb-1"
              style={{ fontSize: "11px" }}
            >
              {profile.archetype}
            </p>
            <p className="text-slate-500" style={{ fontSize: "10px" }}>
              {profile.dominant_road} · 
              RMS {profile.vib_rms_mean?.toFixed(2) ?? "—"} m/s²
            </p>
          </div>
        ))}
      </div>

    </div>
  );
}