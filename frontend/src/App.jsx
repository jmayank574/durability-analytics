import { useData } from "./hooks/useData";
import StatCards from "./components/StatCards";
import DamageChart from "./components/DamageChart";
import PSDChart from "./components/PSDChart";
import RainflowChart from "./components/RainflowChart";
import ClassifierResults from "./components/ClassifierResults";
import FleetMap from "./components/FleetMap";
import ArchetypePanel from "./components/ArchetypePanel";

export default function App() {
  const { data, loading, error } = useData();

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen bg-slate-900">
      <p className="text-slate-400 text-lg">Loading pipeline results...</p>
    </div>
  );

  if (error) return (
    <div className="flex items-center justify-center min-h-screen bg-slate-900">
      <p className="text-red-400">Error: {error}</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">

      <header className="border-b border-slate-700 px-8 py-4">
        <div className="max-w-screen-xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-white">
              Durability Analytics Platform
            </h1>
            <p className="text-slate-400 text-xs mt-0.5">
              PVS Dataset · Rainflow · Miner's Rule · 
              Weibull · Random Forest · XGBoost
            </p>
          </div>
          <div className="flex gap-2">
            <span className="px-3 py-1 bg-green-900/40 text-green-400
                           border border-green-700/40 rounded-full text-xs">
              Pipeline live
            </span>
            <span className="px-3 py-1 bg-slate-800 text-slate-400
                           border border-slate-700 rounded-full text-xs">
              PVS 1 · 144,036 samples · 24 min
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-screen-xl mx-auto px-8 py-6 space-y-6">
        <StatCards data={data} />
        <div className="grid grid-cols-2 gap-6">
          <DamageChart data={data.damage} />
          <PSDChart data={data.psd} />
        </div>
        <RainflowChart data={data.damage} />
        <FleetMap data={data.fleet} />
        <div className="grid grid-cols-2 gap-6">
          <ClassifierResults data={data.ml} />
          <ArchetypePanel data={data.ml} />
        </div>
      </main>

      <footer className="border-t border-slate-700 px-8 py-3 mt-6">
        <div className="max-w-screen-xl mx-auto text-slate-600 text-xs">
          Vehicle Durability Data Analytics · 
          Rainflow counting · Miner's Rule · Weibull · 
          Random Forest · XGBoost · K-Means
        </div>
      </footer>

    </div>
  );
}