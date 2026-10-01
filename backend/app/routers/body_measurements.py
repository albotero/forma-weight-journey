from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import current_user
from app.models import BodyMeasurement, User
from app.schemas import BodyMeasurementCreate, BodyMeasurementOut
from app.routers.common import utc_datetime

router = APIRouter()


@router.get("/body-measurements", response_model=list[BodyMeasurementOut])
def list_body_measurements(limit: int = Query(default=100, ge=1, le=500), offset: int = Query(default=0, ge=0), user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[BodyMeasurement]:
    statement = select(BodyMeasurement).where(BodyMeasurement.user_id == user.id).order_by(
        BodyMeasurement.measured_at.desc(), BodyMeasurement.id.desc()).offset(offset).limit(limit)
    return list(db.scalars(statement))


@router.post("/body-measurements", response_model=BodyMeasurementOut, status_code=201)
def create_body_measurement(payload: BodyMeasurementCreate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> BodyMeasurement:
    measurement = BodyMeasurement(user_id=user.id, **payload.model_dump(
        exclude={"measured_at"}), measured_at=utc_datetime(payload.measured_at))
    db.add(measurement)
    db.commit()
    db.refresh(measurement)
    return measurement


@router.put("/body-measurements/{measurement_id}", response_model=BodyMeasurementOut)
def update_body_measurement(measurement_id: int, payload: BodyMeasurementCreate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> BodyMeasurement:
    measurement = db.scalar(select(BodyMeasurement).where(
        BodyMeasurement.id == measurement_id, BodyMeasurement.user_id == user.id))
    if measurement is None:
        raise HTTPException(status_code=404, detail="Measurement not found")
    for field, value in payload.model_dump(exclude={"measured_at"}).items():
        setattr(measurement, field, value)
    measurement.measured_at = utc_datetime(payload.measured_at)
    db.commit()
    db.refresh(measurement)
    return measurement


@router.delete("/body-measurements/{measurement_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_body_measurement(measurement_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    measurement = db.scalar(select(BodyMeasurement).where(
        BodyMeasurement.id == measurement_id, BodyMeasurement.user_id == user.id))
    if measurement is None:
        raise HTTPException(status_code=404, detail="Measurement not found")
    db.delete(measurement)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
