const COLORS = {
  asphalt:     "#60a5fa",
  cobblestone: "#fb923c",
  dirt:        "#4ade80",
};

export default function DamageChart({ data }) {
  const byRoad = data?.by_road_class || {};

  const roads = Object.entries(byRoad)
    .map(([key, vals]) => ({
      key,
      label:    key.charAt(0).toUpperCase() + key.slice(1),
      ratio:    vals.damage_relative_to_asphalt ?? 1.0,
      cycles:   Math.round(vals.n_cycles ?? 0),
      rangeMax: vals.range_max != null ? vals.range_max.toFixed(1) : "—",
    }))
    .sort((a, b) => b.ratio - a.ratio);

  const maxRatio = Math.max(...roads.map(r => r.ratio), 1);
  const cobblestone = roads.find(r => r.key === "cobblestone");

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
      <h2 className="text-sm font-semibold text-white mb-1">
        Fatigue damage by road surface
      </h2>
      <p className="text-slate-400 text-xs mb-6">
        Rainflow counting + Miner's Rule · asphalt = 1.0 baseline
      </p>

      <div className="space-y-6">
        {roads.map(({ key, label, ratio, cycles, rangeMax }) => (
          <div key={key}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: COLORS[key] }}
                />
                <span className="text-slate-200 text-sm font-medium">
                  {label}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-slate-500 text-xs">
                  {rangeMax} m/s² peak range
                </span>
                <span className="text-slate-500 text-xs">
                  {cycles.toLocaleString()} cycles
                </span>
                <span
                  className="text-sm font-bold w-12 text-right"
                  style={{ color: COLORS[key] ?? "#94a3b8" }}
                >
                  {ratio.toFixed(1)}x
                </span>
              </div>
            </div>
            <div className="w-full bg-slate-700 rounded-full h-4">
              <div
                className="h-4 rounded-full"
                style={{
                  width:           `${(ratio / maxRatio) * 100}%`,
                  backgroundColor: COLORS[key] ?? "#94a3b8",
                }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 pt-4 border-t border-slate-700">
        <p className="text-slate-400 text-xs leading-relaxed">
          Damage scales as amplitude³ (Miner's Rule, m=3).
          {cobblestone && (
            <> 1 hour on cobblestone = same fatigue as{" "}
              <span className="text-orange-400 font-medium">
                {cobblestone.ratio.toFixed(0)} hours on asphalt
              </span>.
            </>
          )}
        </p>
      </div>
    </div>
  );
}