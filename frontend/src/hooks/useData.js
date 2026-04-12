import { useState, useEffect } from "react";

export function useData() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    async function fetchAll() {
      try {
        const [damage, psd, ml, fleet] = await Promise.all([
          fetch("/data/damage_summary.json").then(r => r.json()),
          fetch("/data/psd_spectra.json").then(r => r.json()),
          fetch("/data/ml_results.json").then(r => r.json()),
          fetch("/data/fleet_map.json").then(r => r.json()),
        ]);
        setData({ damage, psd, ml, fleet });
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchAll();
  }, []);

  return { data, loading, error };
}