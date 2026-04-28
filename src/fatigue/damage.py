"""
src/fatigue/damage.py

Module 3: Fatigue Damage Estimation
-------------------------------------
Converts raw acceleration signals into fatigue damage numbers using
the three methods explicitly named in the Rivian job description:

  1. Rainflow cycle counting (ASTM E1049)
  2. Miner's Rule — Linear Damage Accumulation  
  3. Weibull distribution fitting

This answers the core durability question:
"How much fatigue damage did this drive accumulate, and what does
the worst-case customer look like?"
"""

import numpy as np
import pandas as pd
from scipy.stats import weibull_min
from pathlib import Path
import yaml
import json
from tqdm import tqdm
import rainflow


def load_config(config_path: str = "config.yaml") -> dict:
    with open(config_path, "r") as f:
        return yaml.safe_load(f)


# ------------------------------------------------------------------ #
# Step 1: Rainflow Cycle Counting
# ------------------------------------------------------------------ #

def rainflow_count(signal: np.ndarray) -> dict:
    """
    Apply rainflow cycle counting to a time-domain signal.

    Rainflow counting (ASTM E1049) decomposes a variable-amplitude
    load history into individual stress cycles. Each cycle has:
      - range  : peak-to-valley difference (amplitude)
      - mean   : midpoint between peak and valley
      - count  : how many times that cycle occurs

    Physical meaning:
      A pothole = one large-range half cycle
      Road roughness = many small-range cycles
      Rainflow separates and counts all of them.

    Args:
        signal : de-meaned acceleration (m/s²) from suspension arm

    Returns dict with cycles, histogram, and summary stats
    """
    cycles_raw = list(rainflow.extract_cycles(signal))

    if not cycles_raw:
        return {
            "cycles":               [],
            "range_hist":           [],
            "range_bins":           [],
            "n_cycles":             0,
            "range_max":            0.0,
            "range_rms":            0.0,
            "total_range_weighted": 0.0,
        }

    ranges = np.array([c[0] for c in cycles_raw])
    means  = np.array([c[1] for c in cycles_raw])
    counts = np.array([c[2] for c in cycles_raw])

    # Histogram for dashboard visualization
    hist, bin_edges = np.histogram(ranges, bins=64, weights=counts)

    return {
        "cycles":               [(float(r), float(m), float(c))
                                  for r, m, c in zip(ranges, means, counts)],
        "range_hist":           hist.tolist(),
        "range_bins":           bin_edges.tolist(),
        "n_cycles":             float(np.sum(counts)),
        "range_max":            float(np.max(ranges)),
        "range_rms":            float(np.sqrt(
                                    np.sum((ranges**2) * counts) / np.sum(counts)
                                )),
        "total_range_weighted": float(np.sum(ranges * counts)),
    }


# ------------------------------------------------------------------ #
# Step 2: Miner's Rule
# ------------------------------------------------------------------ #

def miners_rule(
    cycles:            list,
    sn_k:              float,
    sn_m:              float,
    damage_threshold:  float = 0.001,
    goodman_ultimate:  float = None,
) -> dict:
    """
    Compute cumulative fatigue damage using Miner's Linear Damage Rule.

    Theory:
      S-N curve:    N_f = K / S^m   (cycles to failure at amplitude S)
      Miner's sum:  D = Σ (n_i / N_f_i)
      Failure when: D ≥ 1.0

    For accelerometer proxy data:
      S_i ≈ cycle range (m/s²) — proportional to structural stress
      K, m = material S-N curve constants (generic steel here)

    Goodman mean stress correction (optional):
      Tensile mean stress reduces fatigue life. The modified Goodman line:
        S_a_eff = S_a / (1 - S_m / S_u)
      where S_a = amplitude (range/2), S_m = mean stress, S_u = ultimate.
      Enable by setting goodman_ultimate in config.yaml.

    Args:
        cycles            : list of (range, mean, count) from rainflow
        sn_k              : S-N intercept constant
        sn_m              : S-N slope exponent (3-5 for metals)
        damage_threshold  : ignore cycles below this range (noise floor)
        goodman_ultimate  : ultimate strength proxy (m/s²); None = disabled
    """
    if not cycles:
        return {
            "damage_index":    0.0,
            "n_damaging_cycles": 0,
            "top_cycles":      [],
        }

    sn_k = float(sn_k)
    sn_m = float(sn_m)
    damage_threshold  = float(damage_threshold)
    goodman_ultimate  = float(goodman_ultimate) if goodman_ultimate is not None else None

    total_damage = 0.0
    n_damaging   = 0
    damage_list  = []

    for cycle_range, cycle_mean, count in cycles:
        cycle_range = float(cycle_range)
        cycle_mean  = float(cycle_mean)
        count       = float(count)

        if cycle_range < damage_threshold:
            continue

        effective_range = cycle_range
        if goodman_ultimate is not None:
            # Goodman correction: boost effective amplitude by mean stress ratio.
            # Clamp denominator to avoid division by zero on extreme mean values.
            amplitude  = cycle_range / 2.0
            mean_ratio = abs(cycle_mean) / goodman_ultimate
            mean_ratio = min(mean_ratio, 0.99)
            effective_amplitude = amplitude / (1.0 - mean_ratio)
            effective_range     = effective_amplitude * 2.0

        # Cycles to failure at this (corrected) amplitude
        n_failure = sn_k / (effective_range ** sn_m)

        damage = count / n_failure
        total_damage += damage
        n_damaging   += 1
        damage_list.append({
            "range":  round(float(cycle_range), 4),
            "count":  round(float(count), 2),
            "damage": float(damage),
        })

    return {
        "damage_index":      float(total_damage),
        "n_damaging_cycles": n_damaging,
        "top_cycles":        sorted(
                                 damage_list,
                                 key=lambda x: x["damage"],
                                 reverse=True
                             )[:10],
    }


# ------------------------------------------------------------------ #
# Step 3: Weibull Distribution Fitting
# ------------------------------------------------------------------ #

def fit_weibull(damage_values: list) -> dict:
    """
    Fit a two-parameter Weibull distribution to damage values
    across the driver/vehicle population.

    Why Weibull?
    Standard in reliability engineering. The shape parameter β tells
    you the failure mode:
      β < 1   infant mortality
      β = 1   random failures
      β > 1   wear-out / fatigue (what we expect here)
      β ≈ 3   near-normal, mature product

    In practice Rivian uses Weibull to answer:
    "What damage does the worst 1% of customers accumulate?"
    That P99 value becomes the design target.

    Note: With only 1 dataset we can't fit a meaningful Weibull yet.
    This becomes powerful when we have all 9 PVS datasets.
    """
    values = np.array([v for v in damage_values if v > 0])

    if len(values) < 3:
        return {
            "note":      "Need ≥ 3 datasets for Weibull fit. Add PVS 2-9.",
            "n_values":  len(values),
        }

    try:
        shape, loc, scale = weibull_min.fit(values, floc=0)

        p50 = float(weibull_min.ppf(0.50, shape, loc=loc, scale=scale))
        p90 = float(weibull_min.ppf(0.90, shape, loc=loc, scale=scale))
        p99 = float(weibull_min.ppf(0.99, shape, loc=loc, scale=scale))

        x_plot  = np.linspace(values.min(), values.max() * 1.5, 100)
        cdf     = weibull_min.cdf(x_plot, shape, loc=loc, scale=scale)

        failure_mode = (
            "infant mortality"          if shape < 0.75 else
            "random failures"           if shape < 1.25 else
            "early wear-out"            if shape < 2.5  else
            "wear-out / fatigue"        if shape < 4.0  else
            "tight fatigue distribution"
        )

        return {
            "shape_beta":    round(float(shape), 4),
            "scale_eta":     round(float(scale), 6),
            "p50_damage":    p50,
            "p90_damage":    p90,
            "p99_damage":    p99,
            "failure_mode":  failure_mode,
            "plot_x":        x_plot.tolist(),
            "plot_cdf":      cdf.tolist(),
            "observed":      values.tolist(),
        }

    except Exception as e:
        return {"error": str(e)}


# ------------------------------------------------------------------ #
# Full pipeline: signal → damage index
# ------------------------------------------------------------------ #

def compute_damage_index(
    signal: np.ndarray,
    config: dict,
) -> dict:
    """Full pipeline: raw signal → fatigue damage index."""
    fatigue_cfg = config["fatigue"]

    rf = rainflow_count(signal)

    if not rf["cycles"]:
        return {"damage_index": 0.0, "rainflow": rf, "miners": {}}

    miners = miners_rule(
        cycles            = rf["cycles"],
        sn_k              = fatigue_cfg["sn_k"],
        sn_m              = fatigue_cfg["sn_m"],
        damage_threshold  = fatigue_cfg["damage_threshold"],
        goodman_ultimate  = fatigue_cfg.get("goodman_ultimate"),
    )

    return {
        "damage_index": miners["damage_index"],
        "rainflow":     rf,
        "miners":       miners,
    }


def compute_damage_by_road_class(
    df:         pd.DataFrame,
    signal_col: str,
    config:     dict,
) -> dict:
    """
    Compute and compare fatigue damage across road surface types.
    Normalizes all results relative to asphalt = 1.0 baseline.
    """
    results = {}

    for road_class in sorted(df["road_type"].dropna().unique()):
        mask   = df["road_type"] == road_class
        signal = df.loc[mask, signal_col].dropna().values

        if len(signal) < 100:
            continue

        result = compute_damage_index(signal, config)
        result["road_class"]   = road_class
        result["n_samples"]    = int(len(signal))
        result["duration_sec"] = round(len(signal) / 100.0, 1)
        results[road_class]    = result

    # Normalize relative to asphalt
    if "asphalt" in results and results["asphalt"]["damage_index"] > 0:
        baseline = results["asphalt"]["damage_index"]
        for rc in results:
            results[rc]["damage_relative_to_asphalt"] = round(
                results[rc]["damage_index"] / baseline, 2
            )

    return results


def compute_damage_per_dataset(
    datasets: dict,
    config:   dict,
) -> dict:
    """
    Compute damage index for each dataset.
    These values feed into Weibull fitting — each dataset represents
    one (vehicle, driver, route) combination from the population.
    """
    results = {}

    for dataset_id, df in tqdm(datasets.items(), desc="  Computing damage"):
        if "acc_z_primary" not in df.columns:
            print(f"  Warning: no acc_z_primary in {dataset_id}")
            continue

        signal = df["acc_z_primary"].dropna().values
        result = compute_damage_index(signal, config)

        result["dataset_id"]    = dataset_id
        result["duration_sec"]  = round(len(signal) / 100.0, 1)
        result["damage_per_hour"] = round(
            result["damage_index"] / (len(signal) / 360000.0), 4
        ) if len(signal) > 0 else 0.0

        # Damage per km: more useful than per-hour for durability targeting
        # because fatigue accumulates with road distance, not elapsed time.
        if "speed" in df.columns:
            mean_speed_mps = float(df["speed"].dropna().mean())
            distance_km    = mean_speed_mps * result["duration_sec"] / 1000.0
            result["distance_km"]    = round(distance_km, 2)
            result["damage_per_km"]  = round(
                result["damage_index"] / distance_km, 8
            ) if distance_km > 0 else 0.0
        else:
            result["distance_km"]   = None
            result["damage_per_km"] = None

        # Per road class breakdown
        if "road_type" in df.columns:
            result["by_road_class"] = {
                rc: {
                    "damage_index": v["damage_index"],
                    "damage_relative_to_asphalt":
                        v.get("damage_relative_to_asphalt", 1.0),
                    "n_cycles": v["rainflow"]["n_cycles"],
                }
                for rc, v in compute_damage_by_road_class(
                    df, "acc_z_primary", config
                ).items()
            }

        results[dataset_id] = result

    return results


# ------------------------------------------------------------------ #
# Export for React dashboard
# ------------------------------------------------------------------ #

def build_damage_export(datasets: dict, config: dict) -> dict:
    """Build complete damage JSON for the React dashboard."""
    # Ensure config fatigue values are float (YAML can load as string)
    config["fatigue"]["sn_k"]             = float(config["fatigue"]["sn_k"])
    config["fatigue"]["sn_m"]             = float(config["fatigue"]["sn_m"])
    config["fatigue"]["damage_threshold"] = float(config["fatigue"]["damage_threshold"])
    print("  Computing per-dataset damage...")
    per_dataset = compute_damage_per_dataset(datasets, config)

    # Weibull across datasets (meaningful once we have 9 datasets)
    damage_values = [v["damage_index"] for v in per_dataset.values()
                     if v["damage_index"] > 0]
    weibull       = fit_weibull(damage_values)

    # Road class comparison (pooled across all datasets)
    all_data      = pd.concat(datasets.values(), ignore_index=True)
    road_class_dmg = {}
    if "road_type" in all_data.columns:
        raw = compute_damage_by_road_class(all_data, "acc_z_primary", config)
        road_class_dmg = {
            rc: {
                "damage_index":               round(v["damage_index"], 6),
                "damage_relative_to_asphalt": v.get("damage_relative_to_asphalt", 1.0),
                "n_cycles":                   v["rainflow"]["n_cycles"],
                "range_max":                  v["rainflow"]["range_max"],
                "range_hist":                 v["rainflow"]["range_hist"],
                "range_bins":                 v["rainflow"]["range_bins"],
            }
            for rc, v in raw.items()
        }

    return {
        "per_dataset": {
            k: {
                "damage_index":    v["damage_index"],
                "damage_per_hour": v["damage_per_hour"],
                "damage_per_km":   v.get("damage_per_km"),
                "distance_km":     v.get("distance_km"),
                "duration_sec":    v["duration_sec"],
                "n_cycles":        v["rainflow"]["n_cycles"],
                "range_max":       v["rainflow"]["range_max"],
                "top_cycles":      v["miners"].get("top_cycles", []),
                "by_road_class":   v.get("by_road_class", {}),
            }
            for k, v in per_dataset.items()
        },
        "weibull":        weibull,
        "by_road_class":  road_class_dmg,
        "summary": {
            "max_damage":  max(damage_values) if damage_values else 0,
            "mean_damage": round(float(np.mean(damage_values)), 6)
                           if damage_values else 0,
        },
    }


def save_damage_export(export: dict, config: dict) -> None:
    out_dir  = Path(config["data"]["exports_dir"])
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / config["export"]["files"]["damage_summary"]
    with open(out_path, "w") as f:
        json.dump(export, f, indent=2)
    size_kb = out_path.stat().st_size / 1000
    print(f"  Saved {out_path.name} ({size_kb:.0f} KB)")


if __name__ == "__main__":
    from src.ingestion.loader import load_config, load_processed
    config   = load_config()
    datasets = load_processed(config)
    export   = build_damage_export(datasets, config)
    save_damage_export(export, config)