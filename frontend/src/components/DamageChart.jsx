const COLORS = {
  Asphalt:     "#60a5fa",
  Cobblestone: "#fb923c",
  Dirt:        "#4ade80",
};

const DATA = [
  { road: "Asphalt",     ratio: 1.0,  cycles: 16456, rms: 3.21 },
  { road: "Cobblestone", ratio: 10.1, cycles: 14084, rms: 7.27 },
  { road: "Dirt",        ratio: 5.8,  cycles: 5604,  rms: 7.94 },
];

export default function DamageChart() {
  const max = 10.1;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
      <h2 className="text-sm font-semibold text-white mb-1">
        Fatigue damage by road surface
      </h2>
      <p className="text-slate-400 text-xs mb-6">
        Rainflow counting + Miner's Rule · asphalt = 1.0 baseline
      </p>

      <div className="space-y-6">
        {DATA.map(({ road, ratio, cycles, rms }) => (
          <div key={road}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: COLORS[road] }}
                />
                <span className="text-slate-200 text-sm font-medium">
                  {road}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-slate-500 text-xs">
                  {rms} m/s² RMS
                </span>
                <span className="text-slate-500 text-xs">
                  {cycles.toLocaleString()} cycles
                </span>
                <span
                  className="text-sm font-bold w-12 text-right"
                  style={{ color: COLORS[road] }}
                >
                  {ratio}x
                </span>
              </div>
            </div>
            <div className="w-full bg-slate-700 rounded-full h-4">
              <div
                className="h-4 rounded-full"
                style={{
                  width:           `${(ratio / max) * 100}%`,
                  backgroundColor: COLORS[road],
                }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 pt-4 border-t border-slate-700">
        <p className="text-slate-400 text-xs leading-relaxed">
          Damage scales as amplitude³ (Miner's Rule, m=3). 
          1 hour on cobblestone = same fatigue as{" "}
          <span className="text-orange-400 font-medium">
            10 hours on asphalt
          </span>.
        </p>
      </div>
    </div>
  );
}