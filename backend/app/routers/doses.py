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
    volume = dose_volume_ml(
        payload.dose_mg, medication.concentration_mg, medication.concentration_volume_ml)
    units = u100_units(
        volume, medication.units_per_ml) if medication.units_per_ml is not None else None
    dose = Dose(medication_id=medication.id, administered_at=utc_datetime(payload.administered_at), dose_mg=payload.dose_mg,
                calculated_volume_ml=volume, calculated_u100_units=units, injection_site=payload.injection_site, notes=payload.notes)
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
    volume = dose_volume_ml(
        payload.dose_mg, medication.concentration_mg, medication.concentration_volume_ml)
    dose.medication_id = medication.id
    dose.administered_at = utc_datetime(payload.administered_at)
    dose.dose_mg = payload.dose_mg
    dose.calculated_volume_ml = volume
    dose.calculated_u100_units = u100_units(
        volume, medication.units_per_ml) if medication.units_per_ml is not None else None
    dose.injection_site = payload.injection_site
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
