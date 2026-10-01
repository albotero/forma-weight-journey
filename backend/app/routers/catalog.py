from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import current_user
from app.models import CatalogItem, User
from app.schemas import CatalogItemCreate, CatalogItemOut, CatalogOrderUpdate, CatalogThresholdsUpdate

router = APIRouter()


DEFAULT_BLOOD_PRESSURE_NAME = "Presión arterial"
# Typical normal ranges for an average adult; users can adjust or clear them.
DEFAULT_SYSTOLIC_NORMAL_RANGE = (90.0, 120.0)
DEFAULT_DIASTOLIC_NORMAL_RANGE = (60.0, 80.0)


def _ensure_default_catalog(db: Session, user_id: int, category: str) -> None:
    if category != "lab":
        return
    exists = db.scalar(select(CatalogItem).where(
        CatalogItem.user_id == user_id, CatalogItem.category == "lab", CatalogItem.is_blood_pressure.is_(True)))
    if exists is None:
        db.add(CatalogItem(
            user_id=user_id, category="lab", name=DEFAULT_BLOOD_PRESSURE_NAME,
            unit="mmHg", is_blood_pressure=True,
            normal_min=DEFAULT_SYSTOLIC_NORMAL_RANGE[0], normal_max=DEFAULT_SYSTOLIC_NORMAL_RANGE[1],
            diastolic_normal_min=DEFAULT_DIASTOLIC_NORMAL_RANGE[
                0], diastolic_normal_max=DEFAULT_DIASTOLIC_NORMAL_RANGE[1],
        ))
        db.commit()


@router.get("/catalog/{category}", response_model=list[CatalogItemOut])
def list_catalog_items(category: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[CatalogItem]:
    if category not in ("symptom", "goal", "lab"):
        raise HTTPException(status_code=422, detail="Unknown catalog category")
    _ensure_default_catalog(db, user.id, category)
    statement = select(CatalogItem).where(
        CatalogItem.user_id == user.id, CatalogItem.category == category
    ).order_by(CatalogItem.is_blood_pressure.desc(), CatalogItem.sort_order, CatalogItem.name)
    return list(db.scalars(statement))


@router.put("/catalog/{category}/order", response_model=list[CatalogItemOut])
def reorder_catalog_items(category: str, payload: CatalogOrderUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[CatalogItem]:
    if category not in ("symptom", "goal", "lab"):
        raise HTTPException(status_code=422, detail="Unknown catalog category")
    items = {item.id: item for item in db.scalars(select(CatalogItem).where(
        CatalogItem.user_id == user.id, CatalogItem.category == category)).all()}
    if set(payload.item_ids) != set(items):
        raise HTTPException(
            status_code=422, detail="The order must include exactly the items in this category")
    for index, item_id in enumerate(payload.item_ids):
        items[item_id].sort_order = index
    db.commit()
    statement = select(CatalogItem).where(
        CatalogItem.user_id == user.id, CatalogItem.category == category
    ).order_by(CatalogItem.is_blood_pressure.desc(), CatalogItem.sort_order, CatalogItem.name)
    return list(db.scalars(statement))


@router.post("/catalog", response_model=CatalogItemOut, status_code=status.HTTP_201_CREATED)
def create_catalog_item(payload: CatalogItemCreate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> CatalogItem:
    if payload.diastolic_normal_min is not None or payload.diastolic_normal_max is not None:
        raise HTTPException(
            status_code=422, detail="Diastolic thresholds can only be set on the blood pressure item")
    existing = db.scalars(select(CatalogItem).where(
        CatalogItem.user_id == user.id, CatalogItem.category == payload.category)).all()
    normalized = payload.name.strip()
    if any(item.name.strip().casefold() == normalized.casefold() for item in existing):
        raise HTTPException(
            status_code=409, detail="This item already exists in your catalog")
    next_order = (db.scalar(select(func.max(CatalogItem.sort_order)).where(
        CatalogItem.user_id == user.id, CatalogItem.category == payload.category)) or 0) + 1
    item = CatalogItem(user_id=user.id, category=payload.category, name=normalized,
                       unit=payload.unit, symptom_category=payload.symptom_category,
                       normal_min=payload.normal_min, normal_max=payload.normal_max,
                       sort_order=next_order)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/catalog/{item_id}/thresholds", response_model=CatalogItemOut)
def update_catalog_item_thresholds(item_id: int, payload: CatalogThresholdsUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> CatalogItem:
    item = db.scalar(select(CatalogItem).where(
        CatalogItem.id == item_id, CatalogItem.user_id == user.id))
    if item is None:
        raise HTTPException(status_code=404, detail="Catalog item not found")
    if not item.is_blood_pressure and (payload.diastolic_normal_min is not None or payload.diastolic_normal_max is not None):
        raise HTTPException(
            status_code=422, detail="Diastolic thresholds only apply to blood pressure")
    item.normal_min = payload.normal_min
    item.normal_max = payload.normal_max
    item.diastolic_normal_min = payload.diastolic_normal_min if item.is_blood_pressure else None
    item.diastolic_normal_max = payload.diastolic_normal_max if item.is_blood_pressure else None
    db.commit()
    db.refresh(item)
    return item


@router.delete("/catalog/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_catalog_item(item_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    item = db.scalar(select(CatalogItem).where(
        CatalogItem.id == item_id, CatalogItem.user_id == user.id))
    if item is None:
        raise HTTPException(status_code=404, detail="Catalog item not found")
    if item.is_blood_pressure:
        raise HTTPException(
            status_code=409, detail="The blood pressure catalog item cannot be removed")
    db.delete(item)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
