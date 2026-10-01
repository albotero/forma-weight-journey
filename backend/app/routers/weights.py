from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import current_user
from app.models import User, WeightMeasurement
from app.schemas import WeightCreate, WeightOut
from app.routers.common import utc_datetime

router = APIRouter()


@router.get("/weights", response_model=list[WeightOut])
def list_weights(limit: int = Query(default=100, ge=1, le=500), offset: int = Query(default=0, ge=0), user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[WeightMeasurement]:
    statement = select(WeightMeasurement).where(WeightMeasurement.user_id == user.id).order_by(
        WeightMeasurement.measured_at.desc(), WeightMeasurement.id.desc()).offset(offset).limit(limit)
    return list(db.scalars(statement))


@router.post("/weights", response_model=WeightOut, status_code=201)
def create_weight(payload: WeightCreate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> WeightMeasurement:
    weight = WeightMeasurement(user_id=user.id, **payload.model_dump(exclude={"measured_at"}),
                               measured_at=utc_datetime(payload.measured_at))
    db.add(weight)
    db.commit()
    db.refresh(weight)
    return weight


@router.put("/weights/{weight_id}", response_model=WeightOut)
def update_weight(weight_id: int, payload: WeightCreate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> WeightMeasurement:
    weight = db.scalar(select(WeightMeasurement).where(
        WeightMeasurement.id == weight_id, WeightMeasurement.user_id == user.id))
    if weight is None:
        raise HTTPException(status_code=404, detail="Weight record not found")
    for field, value in payload.model_dump(exclude={"measured_at"}).items():
        setattr(weight, field, value)
    weight.measured_at = utc_datetime(payload.measured_at)
    db.commit()
    db.refresh(weight)
    return weight


@router.delete("/weights/{weight_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_weight(weight_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    weight = db.scalar(select(WeightMeasurement).where(
        WeightMeasurement.id == weight_id, WeightMeasurement.user_id == user.id))
    if weight is None:
        raise HTTPException(status_code=404, detail="Weight record not found")
    db.delete(weight)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
