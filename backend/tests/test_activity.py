import pytest
from pydantic import ValidationError

from app.schemas import JournalEntryCreate


@pytest.mark.parametrize("steps", [0, 3500, 2000000])
def test_individual_activity_accepts_steps_only(steps: int) -> None:
    entry = JournalEntryCreate(
        module="activity", title="Caminata",
        data={"entry_type": "single", "activity_type": "Caminata", "steps": steps},
    )
    assert entry.data["steps"] == steps


@pytest.mark.parametrize("steps", [-1, 2000001, 1.5, 2.0, True, "100"])
def test_individual_steps_require_an_integer_in_range(steps: object) -> None:
    with pytest.raises(ValidationError):
        JournalEntryCreate(
            module="activity", title="Caminata",
            data={"entry_type": "single", "activity_type": "Caminata",
                  "duration_min": 30, "steps": steps},
        )


def test_missing_steps_preserve_existing_measurements() -> None:
    entry = JournalEntryCreate(
        module="activity", title="Bicicleta",
        data={"entry_type": "single", "activity_type": "Bicicleta",
              "duration_min": 45, "distance_km": 12.5, "calories_kcal": 320},
    )
    assert entry.data["distance_km"] == 12.5


def test_empty_individual_activity_is_rejected() -> None:
    with pytest.raises(ValidationError, match="At least one activity measurement"):
        JournalEntryCreate(
            module="activity", title="Caminata",
            data={"entry_type": "single", "activity_type": "Caminata", "steps": None},
        )


def test_gps_route_accepts_precise_coordinates_and_rejects_out_of_range_points() -> None:
    route = [{"latitude": 4.711123, "longitude": -74.072321, "altitude_m": 2600.25, "segment": 0}]
    entry = JournalEntryCreate(
        module="activity",
        title="Bicicleta",
        data={"entry_type": "single", "activity_type": "Bicicleta", "distance_km": 1, "route": route},
    )
    assert entry.data["route"] == route
    with pytest.raises(ValidationError, match="Route latitude"):
        JournalEntryCreate(
            module="activity",
            title="Bicicleta",
            data={
                "entry_type": "single",
                "activity_type": "Bicicleta",
                "distance_km": 1,
                "route": [{**route[0], "latitude": 91}],
            },
        )


def test_gps_moving_duration_must_be_within_total_duration() -> None:
    entry = JournalEntryCreate(
        module="activity",
        title="Bicicleta",
        data={
            "entry_type": "single",
            "activity_type": "Bicicleta",
            "tracking_source": "gps",
            "duration_min": 40,
            "moving_duration_min": 30,
            "distance_km": 10,
        },
    )
    assert entry.data["moving_duration_min"] == 30
    with pytest.raises(ValidationError, match="cannot exceed"):
        JournalEntryCreate(
            module="activity",
            title="Bicicleta",
            data={
                "entry_type": "single",
                "activity_type": "Bicicleta",
                "tracking_source": "gps",
                "duration_min": 30,
                "moving_duration_min": 31,
                "distance_km": 10,
            },
        )
