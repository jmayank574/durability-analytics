"""
src/signal_processing/spectra.py

Module 2: Signal Processing — FFT & Power Spectral Density
------------------------------------------------------------
Converts raw time-domain acceleration signals into frequency-domain
representations. This is how Rivian characterizes the vibration
environment a component must survive.

Key outputs:
  - PSD per road class (asphalt vs cobblestone vs dirt)
  - Transmissibility (how much vibration the suspension absorbs)
  - Statistical features per window (input to ML classifier)
  - JSON export for React dashboard
"""

import numpy as np
import pandas as pd
from scipy import signal as scipy_signal
from scipy.stats import kurtosis, skew
from pathlib import Path
import yaml
import json
from tqdm import tqdm


def load_config(config_path: str = "config.yaml") -> dict:
    with open(config_path, "r") as f:
        return yaml.safe_load(f)


# ------------------------------------------------------------------ #
# Core signal metrics
# ------------------------------------------------------------------ #

def compute_rms(x: np.ndarray) -> float:
    """
    Root Mean Square — the standard amplitude metric in vibration engineering.
    Higher RMS = more energy = more fatigue damage accumulating.
    """
    return float(np.sqrt(np.mean(x ** 2)))


def compute_crest_factor(x: np.ndarray) -> float:
    """
    Peak / RMS ratio.
    Low (~1.4)  = smooth road roughness, Gaussian random vibration
    High (>4.0) = impulsive events dominate (potholes, speed bumps)
    Critical for distinguishing roughness-dominated vs impact-dominated fatigue.
    """
    rms = compute_rms(x)
    if rms == 0:
        return 0.0
    return float(np.max(np.abs(x)) / rms)


def compute_signal_stats(x: np.ndarray, fs: float = 100.0) -> dict:
    """
    Full statistical characterization of a signal window.
    These 12 features become the input to the ML road surface classifier.
    """
    return {
        "rms":            compute_rms(x),
        "peak":           float(np.max(np.abs(x))),
        "crest_factor":   compute_crest_factor(x),
        "kurtosis":       float(kurtosis(x)),
        "skewness":       float(skew(x)),
        "std":            float(np.std(x)),
        "p95":            float(np.percentile(np.abs(x), 95)),
        "p99":            float(np.percentile(np.abs(x), 99)),
    }


# ------------------------------------------------------------------ #
# Power Spectral Density
# ------------------------------------------------------------------ #

def compute_psd(
    x: np.ndarray,
    fs: float = 100.0,
    nperseg: int = None,
) -> tuple:
    """
    Compute one-sided Power Spectral Density using Welch's method.

    Welch's method splits the signal into overlapping windows, applies
    a Hann window to reduce spectral leakage, then averages the
    periodograms to reduce variance.

    Returns:
        freqs : frequency array in Hz
        psd   : power spectral density in (m/s²)²/Hz

    Why this matters for Rivian:
        The PSD is literally what durability engineers use to write
        component specifications. "This bracket must survive a PSD of
        X (m/s²)²/Hz from 0-50Hz for 150,000 miles."
    """
    if nperseg is None:
        nperseg = min(int(fs * 2.0), len(x) // 4)

    noverlap = nperseg // 2

    freqs, psd = scipy_signal.welch(
        x,
        fs=fs,
        window="hann",
        nperseg=nperseg,
        noverlap=noverlap,
        scaling="density",
    )
    return freqs, psd


def compute_psd_by_road_class(
    df: pd.DataFrame,
    signal_col: str,
    fs: float = 100.0,
) -> dict:
    """
    Compute average PSD for each road surface class.

    This directly answers: "What does the vibration environment look
    like on cobblestone vs asphalt, and how do they differ?"

    Returns:
        { road_type: { freqs, psd_mean, rms, n_samples } }
    """
    results = {}

    for road_class in sorted(df["road_type"].dropna().unique()):
        mask   = df["road_type"] == road_class
        signal = df.loc[mask, signal_col].dropna().values

        # Need at least 4 seconds of data
        if len(signal) < fs * 4:
            continue

        freqs, psd = compute_psd(signal, fs)

        results[road_class] = {
            "freqs":      freqs.tolist(),
            "psd_mean":   psd.tolist(),
            "rms":        compute_rms(signal),
            "n_samples":  int(len(signal)),
            "duration_sec": round(len(signal) / fs, 1),
        }

    return results


def compute_transmissibility(
    df: pd.DataFrame,
    input_col: str,
    output_col: str,
    fs: float = 100.0,
) -> dict:
    """
    Transmissibility = PSD_output / PSD_input as a function of frequency.

    This tells you how well the suspension isolates the body from road inputs:
      < 1.0 : suspension is absorbing energy at that frequency (good)
      = 1.0 : no isolation
      > 1.0 : amplification — resonance (dangerous for fatigue)

    Resonant peaks in transmissibility are exactly what Rivian's NVH
    and durability teams tune suspension to minimize.
    """
    sig_in  = df[input_col].dropna().values
    sig_out = df[output_col].dropna().values

    min_len = min(len(sig_in), len(sig_out))
    sig_in  = sig_in[:min_len]
    sig_out = sig_out[:min_len]

    freqs, psd_in  = compute_psd(sig_in,  fs)
    freqs, psd_out = compute_psd(sig_out, fs)

    # Avoid division by zero
    transmissibility = np.where(psd_in > 1e-12, psd_out / psd_in, 0.0)

    # Find resonant frequency (peak transmissibility)
    resonant_idx   = np.argmax(transmissibility)
    resonant_freq  = float(freqs[resonant_idx])
    resonant_amp   = float(transmissibility[resonant_idx])

    # Isolation at key frequencies
    def get_at_freq(arr, target_hz):
        idx = np.argmin(np.abs(freqs - target_hz))
        return float(arr[idx])

    return {
        "freqs":              freqs.tolist(),
        "transmissibility":   transmissibility.tolist(),
        "psd_input":          psd_in.tolist(),
        "psd_output":         psd_out.tolist(),
        "resonant_freq_hz":   resonant_freq,
        "resonant_amplitude": resonant_amp,
        "isolation_at_5hz":   get_at_freq(transmissibility, 5.0),
        "isolation_at_10hz":  get_at_freq(transmissibility, 10.0),
        "isolation_at_20hz":  get_at_freq(transmissibility, 20.0),
    }


# ------------------------------------------------------------------ #
# Window-based feature extraction for ML
# ------------------------------------------------------------------ #

def extract_feature_windows(
    df: pd.DataFrame,
    signal_cols: list,
    window_samples: int = 200,
    stride_samples: int = 50,
    fs: float = 100.0,
    label_col: str = "road_type",
) -> pd.DataFrame:
    """
    Slide a window across the time series and extract features.
    Each window = 2 seconds of data (200 samples at 100Hz).
    Stride = 0.5 seconds (75% overlap between windows).

    Output is a flat DataFrame where each row = one window
    with ~30 features + label. This becomes the training data
    for the road surface classifier.

    Why windows and not the raw signal?
        ML classifiers need fixed-size inputs. A window of 200 samples
        is long enough to capture road texture patterns but short enough
        to label accurately (road type changes every few seconds).
    """
    records = []
    n = len(df)

    for start in range(0, n - window_samples, stride_samples):
        end = start + window_samples

        record = {
            "window_start": start,
            "time_sec":     round(start / fs, 2),
        }

        # Label: majority class in this window
        if label_col in df.columns:
            window_labels = df[label_col].iloc[start:end]
            record["label"] = window_labels.mode().iloc[0] \
                if not window_labels.isna().all() else "unknown"
        else:
            record["label"] = "unknown"

        # Speed bump flag: 1 if any bump in window
        if "speed_bump" in df.columns:
            record["has_speed_bump"] = int(
                df["speed_bump"].iloc[start:end].max()
            )

        # Speed stats
        if "speed" in df.columns:
            record["speed_mean"] = float(df["speed"].iloc[start:end].mean())

        # Features per signal channel
        for col in signal_cols:
            if col not in df.columns:
                continue

            window = df[col].iloc[start:end].values
            stats  = compute_signal_stats(window, fs)

            for stat_name, val in stats.items():
                record[f"{col}__{stat_name}"] = round(val, 6)

            # Frequency band energy
            freqs, psd = compute_psd(window, fs)
            record[f"{col}__energy_0_5hz"]   = round(float(
                np.trapezoid(psd[freqs < 5], freqs[freqs < 5])), 6)
            record[f"{col}__energy_5_20hz"]  = round(float(
                np.trapezoid(psd[(freqs >= 5) & (freqs < 20)],
             freqs[(freqs >= 5) & (freqs < 20)])), 6)
            record[f"{col}__energy_20_50hz"] = round(float(
                np.trapezoid(psd[freqs >= 20], freqs[freqs >= 20])), 6)
            record[f"{col}__dominant_freq"]  = round(float(
                freqs[np.argmax(psd)]), 2)

        records.append(record)

    return pd.DataFrame(records)


# ------------------------------------------------------------------ #
# Build export for React dashboard
# ------------------------------------------------------------------ #

def build_spectra_export(
    datasets: dict,
    config: dict,
) -> dict:
    """
    Build the JSON consumed by the React PSD spectra panel.

    Structure:
    {
      "by_road_class":    { road_type: { freqs, psd_mean, rms } },
      "transmissibility": { dataset_id: { freqs, transmissibility } },
      "rms_summary":      { dataset_id: { below, above, dashboard } }
    }
    """
    fs     = config["data"]["resample_hz"]
    export = {
        "by_road_class":    {},
        "transmissibility": {},
        "rms_summary":      {},
    }

    # Pool all data for cross-dataset road class PSD
    all_data = pd.concat(datasets.values(), ignore_index=True)

    primary_col = "acc_z_primary"
    below_col   = "acc_z_below_suspension_demean"
    above_col   = "acc_z_above_suspension_demean"
    dash_col    = "acc_z_dashboard_demean"

    # PSD by road class
    if primary_col in all_data.columns and "road_type" in all_data.columns:
        print("  Computing PSD by road class...")
        export["by_road_class"] = compute_psd_by_road_class(
            all_data, primary_col, fs
        )

    # Per-dataset transmissibility and RMS summary
    for dataset_id, df in tqdm(datasets.items(), desc="  Per-dataset spectra"):

        # Transmissibility: below → above suspension
        if below_col in df.columns and above_col in df.columns:
            export["transmissibility"][dataset_id] = compute_transmissibility(
                df, below_col, above_col, fs
            )

        # RMS summary per location
        rms_row = {}
        for label, col in [
            ("below_suspension", below_col),
            ("above_suspension", above_col),
            ("dashboard",        dash_col),
        ]:
            if col in df.columns:
                rms_row[label] = round(compute_rms(df[col].values), 4)
        export["rms_summary"][dataset_id] = rms_row

    return export


def save_spectra_export(export: dict, config: dict) -> None:
    out_dir  = Path(config["data"]["exports_dir"])
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / config["export"]["files"]["psd_spectra"]
    with open(out_path, "w") as f:
        json.dump(export, f, indent=2)
    size_kb = out_path.stat().st_size / 1000
    print(f"  Saved {out_path.name} ({size_kb:.0f} KB)")


def build_feature_windows_export(
    datasets: dict,
    config: dict,
) -> pd.DataFrame:
    """
    Extract ML feature windows from all datasets.
    Saved as CSV — becomes the training data for the classifier.
    """
    signal_cols = [
        "acc_z_below_suspension_demean",
        "acc_z_above_suspension_demean",
        "acc_x_below_suspension",
        "acc_y_below_suspension",
        "gyro_z_below_suspension",
    ]

    all_windows = []
    for dataset_id, df in tqdm(datasets.items(), desc="  Extracting windows"):
        available_cols = [c for c in signal_cols if c in df.columns]
        windows = extract_feature_windows(
            df,
            signal_cols=available_cols,
            window_samples=config["ml"]["window_size_samples"],
            stride_samples=config["ml"]["window_stride_samples"],
            fs=config["data"]["resample_hz"],
        )
        windows["dataset_id"] = dataset_id
        all_windows.append(windows)

    combined = pd.concat(all_windows, ignore_index=True)

    # Save to processed folder
    out_path = Path(config["data"]["processed_dir"]) / "feature_windows.csv"
    combined.to_csv(out_path, index=False)
    print(f"  Saved feature_windows.csv — {len(combined):,} windows, "
          f"{len(combined.columns)} features")

    return combined


if __name__ == "__main__":
    from src.ingestion.loader import load_config, load_processed

    config   = load_config()
    datasets = load_processed(config)

    print("Building spectra export...")
    export = build_spectra_export(datasets, config)
    save_spectra_export(export, config)

    print("\nExtracting ML feature windows...")
    windows = build_feature_windows_export(datasets, config)
    print(f"\nDone. Label distribution:")
    print(windows["label"].value_counts())