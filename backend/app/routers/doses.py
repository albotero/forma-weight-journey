from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.calculations import dose_volume_ml, u100_units
from app.database import get_db
from app.dependencies import current_user
from app.models import Dose, Medication, User
from app.schemas import DoseCreate, DoseOut
from app.routers.common import utc_datetime

router = APIRouter()


def dose_storage_values(payload: DoseCreate, medication: Medication) -> dict[str, object]:
    if payload.dose_amount is None:
        raise HTTPException(status_code=422, detail="Dose amount is required")
    if medication.route == "injectable":
        if payload.dose_unit != "mg":
            raise HTTPException(
                status_code=422, detail="Injectable doses must be recorded in mg")
        if medication.concentration_mg is None or medication.concentration_volume_ml is None:
            raise HTTPException(
                status_code=409, detail="Set the injectable concentration before recording a dose")
        if payload.injection_site is not None:
            injection_site = payload.injection_site
        else:
            injection_site = None
        volume = dose_volume_ml(
            payload.dose_amount, medication.concentration_mg, medication.concentration_volume_ml)
        return {
            "dose_mg": payload.dose_amount,
            "dose_amount": payload.dose_amount,
            "dose_unit": "mg",
            "calculated_volume_ml": volume,
            "calculated_u100_units": u100_units(
                volume, medication.units_per_ml) if medication.units_per_ml is not None else None,
            "injection_site": injection_site,
        }
    if payload.injection_site is not None:
        raise HTTPException(
            status_code=422, detail="Injection site only applies to injectable medications")
    return {
        "dose_mg": payload.dose_mg,
        "dose_amount": payload.dose_amount,
        "dose_unit": payload.dose_unit,
        "calculated_volume_ml": None,
        "calculated_u100_units": None,
        "injection_site": None,
    }


@router.get("/doses", response_model=list[DoseOut])
def list_doses(limit: int = Query(default=100, ge=1, le=500), offset: int = Query(default=0, ge=0), user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[Dose]:
    statement = select(Dose).join(Medication).where(Medication.user_id == user.id).order_by(
        Dose.administered_at.desc(), Dose.id.desc()).offset(offset).limit(limit)
    return list(db.scalars(statement))


@router.post("/doses", response_model=DoseOut, status_code=201)
def create_dose(payload: DoseCreate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Dose:
    medication = db.scalar(select(Medication).where(
        Medication.id == payload.medication_id, Medication.user_id == user.id, Medication.active.is_(True)))
    if medication is None:
        raise HTTPException(
            status_code=404, detail="Active medication not found")
    dose = Dose(
        medication_id=medication.id,
        administered_at=utc_datetime(payload.administered_at),
        notes=payload.notes,
        **dose_storage_values(payload, medication),
    )
    db.add(dose)
    db.commit()
    db.refresh(dose)
    return dose


@router.put("/doses/{dose_id}", response_model=DoseOut)
def update_dose(dose_id: int, payload: DoseCreate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Dose:
    dose = db.scalar(select(Dose).join(Medication).where(
        Dose.id == dose_id, Medication.user_id == user.id))
    if dose is None:
        raise HTTPException(status_code=404, detail="Dose record not found")
    medication = db.scalar(select(Medication).where(
        Medication.id == payload.medication_id, Medication.user_id == user.id))
    if medication is None:
        raise HTTPException(status_code=404, detail="Medication not found")
    dose_values = dose_storage_values(payload, medication)
    dose.medication_id = medication.id
    dose.administered_at = utc_datetime(payload.administered_at)
    for field, value in dose_values.items():
        setattr(dose, field, value)
    dose.notes = payload.notes
    db.commit()
    db.refresh(dose)
    return dose


@router.delete("/doses/{dose_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_dose(dose_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    dose = db.scalar(select(Dose).join(Medication).where(
        Dose.id == dose_id, Medication.user_id == user.id))
    if dose is None:
        raise HTTPException(status_code=404, detail="Dose record not found")
    db.delete(dose)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
