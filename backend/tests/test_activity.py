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
