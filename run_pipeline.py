"""
run_pipeline.py
---------------
Master pipeline runner. Runs the full durability analytics pipeline
end to end with a single command:

    python run_pipeline.py

Outputs JSON files to data/exports/ — consumed by the React dashboard.

Modules:
    1. Ingestion      — load + clean PVS CSV files
    2. Spectra        — FFT / PSD vibration spectra
    3. Fatigue        — rainflow + Miner's Rule + Weibull
    4. ML             — road classifier + damage regressor + archetypes
"""

import sys
import time
import warnings
import numpy as np
import pandas as pd
from pathlib import Path

warnings.filterwarnings("ignore")

# Make sure src/ is importable
sys.path.insert(0, str(Path(__file__).parent))

from src.ingestion.loader import (
    load_config,
    load_pvs_dataset,
    save_processed,
    load_processed,
    compute_dataset_summary,
)
from src.signal_processing.spectra import (
    build_spectra_export,
    save_spectra_export,
    build_feature_windows_export,
)
from src.fatigue.damage import (
    build_damage_export,
    save_damage_export,
    rainflow_count,
    miners_rule,
)
from src.ml.classifier import (
    build_ml_export,
    save_ml_export,
)


def banner(text: str) -> None:
    print(f"\n{'='*60}")
    print(f"  {text}")
    print(f"{'='*60}")


def elapsed(t: float) -> str:
    return f"{time.time() - t:.1f}s"


def main():
    total_start = time.time()
    config      = load_config()

    banner("Rivian Durability Analytics Pipeline")
    print(f"  Config loaded from config.yaml")
    print(f"  Exports → {config['data']['exports_dir']}/")

    # ---------------------------------------------------------- #
    # Module 1: Data Ingestion
    # ---------------------------------------------------------- #
    banner("Module 1 · Data Ingestion")
    t = time.time()

    processed_dir = Path(config["data"]["processed_dir"])
    processed_files = list(processed_dir.glob("pvs*.csv"))

    if processed_files:
        print(f"  Found {len(processed_files)} cached processed files")
        print(f"  Loading from cache (faster than re-processing raw CSVs)")
        datasets = load_processed(config)
    else:
        print(f"  No cache found — loading from raw CSVs")
        try:
            datasets = load_pvs_dataset(config)
            save_processed(datasets, config)
        except FileNotFoundError as e:
            print(f"\n  ERROR: {e}")
            print("\n  To get started:")
            print("  1. Download PVS dataset CSVs from Kaggle")
            print("  2. Place them in data/raw/")
            print("  3. Re-run this script")
            sys.exit(1)

    summary = compute_dataset_summary(datasets)
    print(f"\n  Datasets loaded: {list(datasets.keys())}")
    print(f"\n  Summary:")
    print(summary.to_string())
    print(f"\n  Completed in {elapsed(t)}")

    # ---------------------------------------------------------- #
    # Module 2: Signal Processing
    # ---------------------------------------------------------- #
    banner("Module 2 · Signal Processing — FFT / PSD Spectra")
    t = time.time()

    spectra_export = build_spectra_export(datasets, config)
    save_spectra_export(spectra_export, config)

    road_classes = list(spectra_export["by_road_class"].keys())
    print(f"  PSD computed for: {road_classes}")
    print(f"  Completed in {elapsed(t)}")

    # ---------------------------------------------------------- #
    # Module 3: Fatigue Damage
    # ---------------------------------------------------------- #
    banner("Module 3 · Fatigue Damage — Rainflow + Miner's Rule + Weibull")
    t = time.time()

    damage_export = build_damage_export(datasets, config)
    save_damage_export(damage_export, config)

    print(f"\n  Damage by road class:")
    for rc, data in damage_export["by_road_class"].items():
        ratio = data.get("damage_relative_to_asphalt", 1.0)
        print(f"    {rc:<15} {ratio:.1f}x asphalt baseline")

    weibull = damage_export.get("weibull", {})
    if "shape_beta" in weibull:
        print(f"\n  Weibull β = {weibull['shape_beta']:.3f} "
              f"({weibull.get('failure_mode', '')})")
        print(f"  P99 damage = {weibull['p99_damage']:.4e}")
    else:
        print(f"\n  Weibull: {weibull.get('note', 'not fitted')}")

    print(f"  Completed in {elapsed(t)}")

    # ---------------------------------------------------------- #
    # Module 4: ML
    # ---------------------------------------------------------- #
    banner("Module 4 · Machine Learning — Classifier + Regressor + Archetypes")
    t = time.time()

    # Check for cached feature windows
    windows_path = Path(config["data"]["processed_dir"]) / "feature_windows.csv"

    if windows_path.exists():
        print(f"  Loading cached feature windows...")
        windows = pd.read_csv(windows_path)
        # Filter out feature_windows from datasets if present
        windows = windows[windows.get("dataset_id", pd.Series(dtype=str)) != "feature_windows"] \
            if "dataset_id" in windows.columns else windows
    else:
        print(f"  Extracting feature windows...")
        windows = build_feature_windows_export(datasets, config)

    print(f"  Windows: {len(windows):,} | Features: {len(windows.columns)}")

    # Add damage index per window
    print(f"  Computing per-window damage index...")
    sn_k      = float(config["fatigue"]["sn_k"])
    sn_m      = float(config["fatigue"]["sn_m"])
    threshold = float(config["fatigue"]["damage_threshold"])

    # Use first dataset for damage computation
    primary_df   = list(datasets.values())[0]
    signal       = primary_df["acc_z_primary"].dropna().values
    road_types   = primary_df["road_type"].values
    window_size  = config["ml"]["window_size_samples"]
    stride       = config["ml"]["window_stride_samples"]

    damage_records = []
    for start in range(0, len(signal) - window_size, stride):
        end    = start + window_size
        window = signal[start:end]
        rf     = rainflow_count(window)
        if rf["cycles"]:
            miners = miners_rule(rf["cycles"], sn_k, sn_m, threshold)
            dmg    = miners["damage_index"]
        else:
            dmg = 0.0
        damage_records.append({
            "window_start":  start,
            "damage_index":  dmg,
        })

    damage_df = pd.DataFrame(damage_records)

    # Merge damage into windows
    if "window_start" in windows.columns:
        windows = windows.merge(
            damage_df, on="window_start", how="left"
        )
        windows["damage_index"] = windows["damage_index"].fillna(0)

    # Train models
    ml_export, clf_model, reg_model = build_ml_export(
        windows, config, damage_col="damage_index"
    )
    save_ml_export(ml_export, config)

    print(f"\n  Classifier accuracy : "
          f"{ml_export['classifier']['accuracy']:.1%}")
    print(f"  CV accuracy         : "
          f"{ml_export['classifier']['cv_accuracy_mean']:.1%} "
          f"± {ml_export['classifier']['cv_accuracy_std']:.1%}")
    print(f"  Damage regressor R² : "
          f"{ml_export['regressor'].get('r2_score', 'N/A')}")
    print(f"  Archetypes found    : "
          f"{ml_export['clustering']['n_clusters']}")
    print(f"  Completed in {elapsed(t)}")

    # ---------------------------------------------------------- #
    # Build fleet map export
    # ---------------------------------------------------------- #
    banner("Building Fleet Map Export")
    t = time.time()
    _build_fleet_map(datasets, damage_df, config)
    print(f"  Completed in {elapsed(t)}")

    # ---------------------------------------------------------- #
    # Summary
    # ---------------------------------------------------------- #
    banner(f"Pipeline Complete — {elapsed(total_start)} total")

    exports_dir  = Path(config["data"]["exports_dir"])
    export_files = list(exports_dir.glob("*.json"))
    print(f"\n  {len(export_files)} JSON files exported to {exports_dir}/")
    for f in sorted(export_files):
        size_kb = f.stat().st_size / 1024
        print(f"    {f.name:<35} {size_kb:>6.1f} KB")

    print(f"\n  Next step: cd frontend && npm install && npm run dev")


def _build_fleet_map(
    datasets: dict,
    damage_df: pd.DataFrame,
    config: dict,
) -> None:
    """
    Build GPS fleet map export for the React Leaflet map.
    Each point = one GPS coordinate with damage index attached.
    """
    import json

    all_points = []

    for dataset_id, df in datasets.items():
        if "latitude" not in df.columns or "longitude" not in df.columns:
            continue

        # Sample every 10th row for map performance
        df_sample = df.iloc[::50].copy().reset_index(drop=True)

        # Attach damage — approximate by matching time index
        window_size = config["ml"]["window_size_samples"]
        stride      = config["ml"]["window_stride_samples"]

        for i, row in df_sample.iterrows():
            orig_idx    = i * 10
            window_idx  = orig_idx // stride
            damage      = 0.0

            if window_idx < len(damage_df):
                damage = float(damage_df.iloc[window_idx]["damage_index"])

            point = {
                "lat":        round(float(row["latitude"]),  6),
                "lng":        round(float(row["longitude"]), 6),
                "damage":     damage,
                "road_type":  str(row.get("road_type", "unknown")),
                "speed":      round(float(row.get("speed", 0)), 2),
                "dataset_id": dataset_id,
            }
            all_points.append(point)

    export = {
        "points":    all_points,
        "n_points":  len(all_points),
        "datasets":  list(datasets.keys()),
    }

    out_dir  = Path(config["data"]["exports_dir"])
    out_path = out_dir / config["export"]["files"]["fleet_map"]
    out_dir.mkdir(parents=True, exist_ok=True)

    with open(out_path, "w") as f:
        json.dump(export, f, indent=2)

    size_kb = out_path.stat().st_size / 1024
    print(f"  Fleet map: {len(all_points):,} GPS points → "
          f"{out_path.name} ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()