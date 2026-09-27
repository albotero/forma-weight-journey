from collections.abc import Sequence
from datetime import datetime, timedelta, timezone


def bmi(weight_kg: float, height_cm: float) -> float:
    if weight_kg <= 0 or height_cm <= 0:
        raise ValueError("Weight and height must be positive")
    return weight_kg / (height_cm / 100) ** 2


def weight_loss_percent(initial_weight_kg: float, current_weight_kg: float) -> float:
    if initial_weight_kg <= 0 or current_weight_kg <= 0:
        raise ValueError("Weights must be positive")
    return (initial_weight_kg - current_weight_kg) / initial_weight_kg * 100


def weight_goal(initial_weight_kg: float, loss_percent: float) -> float:
    if initial_weight_kg <= 0 or not 0 <= loss_percent < 100:
        raise ValueError("Invalid initial weight or goal percentage")
    return initial_weight_kg * (1 - loss_percent / 100)


def dose_volume_ml(dose_mg: float, concentration_mg: float, concentration_volume_ml: float) -> float:
    if dose_mg < 0 or concentration_mg <= 0 or concentration_volume_ml <= 0:
        raise ValueError(
            "Dose must be non-negative and concentration values positive")
    return dose_mg / (concentration_mg / concentration_volume_ml)


def u100_units(volume_ml: float, units_per_ml: float = 100) -> float:
    if volume_ml < 0 or units_per_ml <= 0:
        raise ValueError(
            "Volume must be non-negative and units per mL positive")
    return volume_ml * units_per_ml


def rolling_weight_average(entries: Sequence[tuple[datetime, float]], days: int, now: datetime | None = None) -> float | None:
    if days <= 0:
        raise ValueError("Days must be positive")
    end = now or datetime.now(timezone.utc)
    start = end - timedelta(days=days)
    values = [weight for timestamp,
              weight in entries if start <= timestamp <= end]
    return sum(values) / len(values) if values else None


def weekly_weight_change(entries: Sequence[tuple[datetime, float]]) -> float | None:
    """Descriptive weekly change between available readings, normalized to seven days."""
    ordered = sorted(entries, key=lambda entry: entry[0])
    if len(ordered) < 2:
        return None
    first_time, first_weight = ordered[0]
    last_time, last_weight = ordered[-1]
    elapsed_days = (last_time - first_time).total_seconds() / 86400
    if elapsed_days <= 0:
        return None
    return (last_weight - first_weight) / elapsed_days * 7
