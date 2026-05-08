"""
src/ingestion/loader.py
Data Ingestion & Cleaning — corrected for real PVS column names and structure.
"""

import pandas as pd
import numpy as np
import yaml
from pathlib import Path
from tqdm import tqdm


def load_config(config_path: str = "config.yaml") -> dict:
    with open(config_path, "r") as f:
        return yaml.safe_load(f)


def load_pvs_dataset(config: dict, verbose: bool = True) -> dict:
    """
    Load PVS CSV files from data/raw/.
    PVS stores sensor data and labels in separate files — we merge them.
    Handles both plain filenames (dataset_gps_mpu_left.csv)
    and prefixed filenames (pvs1_dataset_gps_mpu_left.csv).
    """
    raw_dir = Path(config["data"]["raw_dir"])
    datasets = {}

    mpu_files = sorted(raw_dir.glob("*dataset_gps_mpu_left.csv"))

    if not mpu_files:
        raise FileNotFoundError(
            f"No MPU CSV files found in {raw_dir}\n"
            "Expected files named: dataset_gps_mpu_left.csv or pvs1_dataset_gps_mpu_left.csv"
        )

    if verbose:
        print(f"Found {len(mpu_files)} datasets")

    for idx, mpu_path in enumerate(tqdm(mpu_files, desc="Loading", disable=not verbose), start=1):
        filename = mpu_path.name

        # Determine prefix and dataset ID
        if filename == "dataset_gps_mpu_left.csv":
            # Plain file with no prefix — assign sequential ID
            prefix     = ""
            dataset_id = f"pvs{idx}"
        else:
            # Prefixed file e.g. pvs2_dataset_gps_mpu_left.csv
            prefix     = filename.replace("dataset_gps_mpu_left.csv", "")
            dataset_id = prefix.rstrip("_")

        label_path = raw_dir / f"{prefix}dataset_labels.csv"
        gps_path   = raw_dir / f"{prefix}dataset_gps.csv"
        right_path = raw_dir / f"{prefix}dataset_gps_mpu_right.csv"

        if not label_path.exists():
            print(f"  Warning: no labels file for {dataset_id}, skipping")
            continue

        df = _load_and_merge(mpu_path, label_path, gps_path, dataset_id, right_path)
        datasets[dataset_id] = df

        if verbose:
            dur = len(df) / config["data"]["sample_rate_hz"]
            bump_count = int(df['speed_bump'].sum()) if 'speed_bump' in df.columns else 0
            print(f"  {dataset_id}: {len(df):,} rows | {dur:.0f}s | "
                  f"roads: {df['road_type'].value_counts().to_dict()} | "
                  f"bumps: {bump_count}")

    return datasets


def _load_and_merge(
    mpu_path: Path,
    label_path: Path,
    gps_path: Path,
    dataset_id: str,
    right_path: Path = None,
) -> pd.DataFrame:
    """
    Load and merge MPU sensor data with road labels.
    - Decodes one-hot encoded labels back to readable strings
    - Averages left + right vertical Z channels when right sensor is available
    - Removes gravity offset from vertical accelerometer channels
    - Creates primary fatigue signal (acc_z below suspension, de-meaned)
    """
    # Load sensor data
    mpu    = pd.read_csv(mpu_path)

    # Average left + right Z channels if right sensor file exists
    if right_path is not None and right_path.exists():
        mpu_right = pd.read_csv(right_path)
        min_len   = min(len(mpu), len(mpu_right))
        mpu       = mpu.iloc[:min_len].reset_index(drop=True)
        mpu_right = mpu_right.iloc[:min_len].reset_index(drop=True)
        z_cols = [
            "acc_z_below_suspension",
            "acc_z_above_suspension",
            "acc_z_dashboard",
        ]
        for col in z_cols:
            if col in mpu.columns and col in mpu_right.columns:
                mpu[col] = (mpu[col] + mpu_right[col]) / 2
        print(f"  [{dataset_id}] Left + right Z channels averaged")
    else:
        print(f"  [{dataset_id}] Right sensor not found — using left channel only")

    labels = pd.read_csv(label_path)

    # Align lengths (should be identical but guard against off-by-one)
    min_len = min(len(mpu), len(labels))
    mpu    = mpu.iloc[:min_len].reset_index(drop=True)
    labels = labels.iloc[:min_len].reset_index(drop=True)

    # ------------------------------------------------------------------ #
    # Decode road type (one-hot → string)
    # ------------------------------------------------------------------ #
    road_type_cols = ['asphalt_road', 'cobblestone_road', 'dirt_road', 'unpaved_road']
    available      = [c for c in road_type_cols if c in labels.columns]
    if available:
        mpu['road_type'] = (
            labels[available]
            .idxmax(axis=1)
            .str.replace('_road', '', regex=False)
        )
    else:
        mpu['road_type'] = 'unknown'

    type_map = {'asphalt': 0, 'cobblestone': 1, 'dirt': 2, 'unpaved': 3}
    mpu['road_type_code'] = mpu['road_type'].map(type_map).fillna(-1).astype(int)

    # ------------------------------------------------------------------ #
    # Decode road quality (one-hot → string)
    # ------------------------------------------------------------------ #
    quality_cols = ['good_road_left', 'regular_road_left', 'bad_road_left']
    available_q  = [c for c in quality_cols if c in labels.columns]
    if available_q:
        mpu['road_quality'] = (
            labels[available_q]
            .idxmax(axis=1)
            .str.replace('_road_left', '', regex=False)
        )
        quality_map = {'good': 2, 'regular': 1, 'bad': 0}
        mpu['road_quality_code'] = mpu['road_quality'].map(quality_map).fillna(-1).astype(int)
    else:
        mpu['road_quality']      = 'unknown'
        mpu['road_quality_code'] = -1

    # ------------------------------------------------------------------ #
    # Decode speed bump
    # PVS uses: no_speed_bump=1 means NO bump, speed_bump_*=1 means bump
    # ------------------------------------------------------------------ #
    if 'no_speed_bump' in labels.columns:
        # speed_bump = 1 where no_speed_bump = 0
        mpu['speed_bump'] = (labels['no_speed_bump'] == 0).astype(int)
    else:
        bump_cols = [c for c in labels.columns if 'speed_bump' in c and 'no_' not in c]
        if bump_cols:
            mpu['speed_bump'] = labels[bump_cols].max(axis=1).astype(int)
        else:
            mpu['speed_bump'] = 0

    # ------------------------------------------------------------------ #
    # Remove gravity from vertical acceleration channels
    # Raw signal = vibration + gravity (~9.81 m/s²)
    # De-meaned signal = vibration only — what we use for fatigue
    # ------------------------------------------------------------------ #
    z_channels = [
        'acc_z_below_suspension',
        'acc_z_above_suspension',
        'acc_z_dashboard',
    ]
    for col in z_channels:
        if col in mpu.columns:
            mpu[f'{col}_demean'] = mpu[col] - mpu[col].mean()

    # Primary fatigue signal — suspension arm vertical, de-meaned
    if 'acc_z_below_suspension' in mpu.columns:
        mpu['acc_z_primary'] = mpu['acc_z_below_suspension_demean']
    elif 'acc_z_above_suspension' in mpu.columns:
        mpu['acc_z_primary'] = mpu['acc_z_above_suspension_demean']

    # ------------------------------------------------------------------ #
    # Time and metadata
    # ------------------------------------------------------------------ #
    mpu['time_sec']   = mpu.index / 100.0
    mpu['dataset_id'] = dataset_id

    return mpu


def compute_dataset_summary(datasets: dict) -> pd.DataFrame:
    records = []
    for dataset_id, df in datasets.items():
        record = {
            'dataset_id':   dataset_id,
            'n_samples':    len(df),
            'duration_sec': round(len(df) / 100.0, 1),
            'speed_mean':   round(df['speed'].mean(), 2) if 'speed' in df.columns else None,
            'speed_max':    round(df['speed'].max(), 2)  if 'speed' in df.columns else None,
        }

        if 'acc_z_primary' in df.columns:
            record['vib_rms']  = round(float(df['acc_z_primary'].std()), 4)
            record['vib_peak'] = round(float(df['acc_z_primary'].abs().max()), 4)

        if 'road_type' in df.columns:
            record['road_types'] = str(df['road_type'].value_counts().to_dict())

        if 'speed_bump' in df.columns:
            # Count distinct bump events (rising edges)
            bump_events = int((df['speed_bump'].diff() == 1).sum())
            record['n_bump_events']   = bump_events
            record['n_bump_samples']  = int(df['speed_bump'].sum())

        records.append(record)

    return pd.DataFrame(records).set_index('dataset_id')


def save_processed(datasets: dict, config: dict) -> None:
    """Save cleaned datasets to data/processed/ as CSV files."""
    out_dir = Path(config["data"]["processed_dir"])
    out_dir.mkdir(parents=True, exist_ok=True)
    for dataset_id, df in datasets.items():
        out_path = out_dir / f"{dataset_id}.csv"
        df.to_csv(out_path, index=False)
        size_mb = out_path.stat().st_size / 1_000_000
        print(f"  Saved {dataset_id}.csv ({size_mb:.1f} MB)")
    print(f"Done — {len(datasets)} datasets saved to {out_dir}/")


def load_processed(config: dict) -> dict:
    processed_dir = Path(config["data"]["processed_dir"])
    datasets = {}
    for filepath in sorted(processed_dir.glob("*.csv")):
        # Skip feature windows — that's ML training data, not a sensor dataset
        if "feature_windows" in filepath.stem:
            continue
        datasets[filepath.stem] = pd.read_csv(filepath)
    if not datasets:
        raise FileNotFoundError(
            f"No processed files in {processed_dir}. "
            "Run load_pvs_dataset() first."
        )
    return datasets


if __name__ == "__main__":
    config   = load_config()
    datasets = load_pvs_dataset(config)
    summary  = compute_dataset_summary(datasets)
    print("\nDataset Summary:")
    print(summary.to_string())
    save_processed(datasets, config)