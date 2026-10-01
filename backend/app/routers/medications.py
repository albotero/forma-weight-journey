from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import current_user
from app.models import Medication, User
from app.schemas import MedicationCreate, MedicationOut

router = APIRouter()


@router.get("/medications", response_model=list[MedicationOut])
def list_medications(user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[Medication]:
    return list(db.scalars(select(Medication).where(Medication.user_id == user.id).order_by(Medication.created_at.desc())))


@router.post("/medications", response_model=MedicationOut, status_code=201)
def create_medication(payload: MedicationCreate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Medication:
    medication = Medication(user_id=user.id, **payload.model_dump())
    db.add(medication)
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
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/medications/{medication_id}/permanent", status_code=status.HTTP_204_NO_CONTENT)
def delete_medication_permanently(medication_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    medication = db.scalar(select(Medication).where(
        Medication.id == medication_id, Medication.user_id == user.id))
    if medication is None:
        raise HTTPException(status_code=404, detail="Medication not found")
    db.delete(medication)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
