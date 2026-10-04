from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import current_user
from app.models import Medication, User
from app.schemas import MedicationCreate, MedicationOut

router = APIRouter()


def _ensure_primary_medication(db: Session, user_id: int) -> Medication | None:
    medications = db.scalars(select(Medication).where(
        Medication.user_id == user_id).order_by(
            Medication.created_at.desc(), Medication.id.desc())).all()
    active = [medication for medication in medications if medication.active]
    primary = next(
        (medication for medication in active if medication.is_primary), None)
    if primary is None and active:
        primary = active[0]
    for medication in medications:
        medication.is_primary = medication is primary
    return primary


@router.get("/medications", response_model=list[MedicationOut])
def list_medications(user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[Medication]:
    return list(db.scalars(select(Medication).where(Medication.user_id == user.id).order_by(Medication.created_at.desc())))


@router.post("/medications", response_model=MedicationOut, status_code=201)
def create_medication(payload: MedicationCreate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Medication:
    medication = Medication(user_id=user.id, **payload.model_dump())
    db.add(medication)
    db.flush()
    _ensure_primary_medication(db, user.id)
    db.commit()
    db.refresh(medication)
    return medication


@router.put("/medications/{medication_id}", response_model=MedicationOut)
def update_medication(medication_id: int, payload: MedicationCreate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Medication:
    medication = db.scalar(select(Medication).where(
        Medication.id == medication_id, Medication.user_id == user.id))
    if medication is None:
        raise HTTPException(status_code=404, detail="Medication not found")
    for field, value in payload.model_dump().items():
        setattr(medication, field, value)
    db.flush()
    _ensure_primary_medication(db, user.id)
    db.commit()
    db.refresh(medication)
    return medication


@router.delete("/medications/{medication_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_medication(medication_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    medication = db.scalar(select(Medication).where(
        Medication.id == medication_id, Medication.user_id == user.id))
    if medication is None:
        raise HTTPException(status_code=404, detail="Medication not found")
    medication.active = False
    db.flush()
    _ensure_primary_medication(db, user.id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/medications/{medication_id}/primary", response_model=MedicationOut)
def set_primary_medication(medication_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Medication:
    medication = db.scalar(select(Medication).where(
        Medication.id == medication_id,
        Medication.user_id == user.id,
        Medication.active.is_(True),
    ))
    if medication is None:
        raise HTTPException(
            status_code=404, detail="Active medication not found")
    for candidate in db.scalars(select(Medication).where(
            Medication.user_id == user.id, Medication.active.is_(True))).all():
        candidate.is_primary = candidate.id == medication.id
    db.commit()
    db.refresh(medication)
    return medication


@router.delete("/medications/{medication_id}/permanent", status_code=status.HTTP_204_NO_CONTENT)
def delete_medication_permanently(medication_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    medication = db.scalar(select(Medication).where(
        Medication.id == medication_id, Medication.user_id == user.id))
    if medication is None:
        raise HTTPException(status_code=404, detail="Medication not found")
    db.delete(medication)
    db.flush()
    _ensure_primary_medication(db, user.id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
