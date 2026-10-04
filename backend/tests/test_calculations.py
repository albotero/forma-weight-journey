from datetime import datetime, timedelta, timezone

import pytest

from app.calculations import bmi, dose_volume_ml, rolling_weight_average, u100_units, weight_goal, weight_loss_percent, weekly_weight_change, weight_moving_average_series


def test_bmi_and_weight_loss() -> None:
    assert bmi(106, 180) == pytest.approx(106 / 1.8**2)
    assert weight_loss_percent(106, 100.7) == pytest.approx(5)


def test_dynamic_weight_goals() -> None:
    assert weight_goal(106, 5) == pytest.approx(100.7)
    assert weight_goal(106, 20) == pytest.approx(84.8)


@pytest.mark.parametrize(("mg", "ml", "units"), [(2.5, .125, 12.5), (5, .25, 25), (7.5, .375, 37.5), (10, .5, 50)])
def test_tirzepatide_concentration_conversions(mg: float, ml: float, units: float) -> None:
    volume = dose_volume_ml(mg, 10, .5)
    assert volume == pytest.approx(ml)
    assert volume * (10 / .5) == pytest.approx(mg)
    assert u100_units(volume) == pytest.approx(units)


def test_rolling_average_and_weekly_change() -> None:
    now = datetime(2026, 9, 26, tzinfo=timezone.utc)
    readings = [(now - timedelta(days=7), 102.0), (now, 101.0)]
    assert rolling_weight_average(readings, 7, now) == pytest.approx(101.5)
    assert weekly_weight_change(readings) == pytest.approx(-1.0)
    assert rolling_weight_average([], 14, now) is None


def test_weight_moving_average_series_uses_seven_days_not_seven_readings() -> None:
    start = datetime(2026, 9, 1, tzinfo=timezone.utc)
    readings = [
        (start + timedelta(days=8), 76),
        (start, 100),
        (start + timedelta(days=7), 80),
        (start + timedelta(days=7), 84),
        (start + timedelta(days=20), 70),
    ]
    assert weight_moving_average_series(readings) == [
        (start, 100),
        (start + timedelta(days=7), 82),
        (start + timedelta(days=8), 80),
        (start + timedelta(days=20), 70),
    ]
    assert weight_moving_average_series([]) == []
    assert weight_moving_average_series(
        [(start.replace(tzinfo=None), 82.5)]) == [(start, 82.5)]
    assert weight_moving_average_series(
        [(start, 80.12), (start, 80.13)]) == [(start, 80.13)]
